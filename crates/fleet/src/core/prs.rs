//! `fleet prs`: the open GitHub pull requests that need you — yours, the ones waiting on your
//! review, and the ones you reviewed that wait on their author — sorted into columns, cached,
//! and joined with the local checkouts (`fleet repos`) and their worktrees.
//!
//! GitHub is reached only through the `gh` CLI (`gh api graphql`): its auth, its host, no token
//! handling here. Three searches, run in parallel:
//!
//! - `author:@me` → [`Column::DraftMine`], [`Column::ReadyToMergeMine`] (approved) or
//!   [`Column::ReviewMine`]
//! - `user-review-requested:@me` (asked of you by name, not via a team) → [`Column::WaitingOnMe`]
//! - `reviewed-by:@me -author:@me`, your latest review not an approval → [`Column::WaitingOnAuthor`]
//!
//! Config (`prs` in config.json — per machine, read leniently):
//!
//! ```json
//! "prs": { "orgs": ["acme"], "repos": ["someone/tool"], "refresh": "5m" }
//! ```
//!
//! `orgs` / `repos` scope the searches (any of them; none = all of GitHub). `refresh` is how old
//! the cache may get before a plain `fleet prs` fetches again.
//!
//! Cache (`$FLEET_PRS_CACHE`, else `${XDG_CACHE_HOME:-~/.cache}/fleet/prs.json`): the last
//! successful fetch. A failed fetch keeps serving it, with the error alongside.
//!
//! Nothing in here prints.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::core::{repos, tools};
use crate::error::{Error, Result};

pub const DEFAULT_REFRESH: &str = "5m";
/// One search page; GitHub's gateway gives up on bigger ones (~10 s) with all the fields below.
const PAGE: usize = 50;
const MAX_PAGES: usize = 4;
const GH_TIMEOUT: Duration = Duration::from_secs(60);

// ---------- config ----------

/// The `prs` config section, parsed.
#[derive(Debug, Clone)]
pub struct Settings {
    pub orgs: Vec<String>,
    /// `owner/name`.
    pub repos: Vec<String>,
    /// Max cache age in seconds.
    pub refresh: i64,
    /// What was wrong with the section; the bad parts fall back to defaults.
    pub problems: Vec<String>,
}

impl Settings {
    pub fn from_value(v: &Value) -> Settings {
        let mut problems = Vec::new();
        let mut strings = |key: &str| -> Vec<String> {
            match v.get(key) {
                None | Some(Value::Null) => Vec::new(),
                Some(Value::Array(a)) => a
                    .iter()
                    .filter_map(|x| {
                        let s = x
                            .as_str()
                            .map(str::trim)
                            .filter(|s| !s.is_empty() && !s.contains(char::is_whitespace));
                        if s.is_none() {
                            problems.push(format!("prs.{key}: {x} is not a name"));
                        }
                        s.map(String::from)
                    })
                    .collect(),
                Some(other) => {
                    problems.push(format!("prs.{key} must be a list, not {other}"));
                    Vec::new()
                }
            }
        };
        let orgs = strings("orgs");
        let repos = strings("repos");
        let default_refresh = crate::core::tmux::parse_span(DEFAULT_REFRESH).unwrap_or(300);
        let refresh = match v.get("refresh").filter(|x| !x.is_null()) {
            None => default_refresh,
            Some(x) => match x.as_str().map(crate::core::tmux::parse_span) {
                Some(Ok(s)) if s >= 60 => s,
                _ => {
                    problems.push(format!("prs.refresh: {x} is not a duration of at least 1m"));
                    default_refresh
                }
            },
        };
        Settings {
            orgs,
            repos,
            refresh,
            problems,
        }
    }

    pub fn load() -> Settings {
        Settings::from_value(&crate::core::config::load().raw["prs"])
    }

    /// The search qualifiers every query shares: `org:a org:b repo:o/n` (GitHub ORs them).
    pub fn scope(&self) -> String {
        self.orgs
            .iter()
            .map(|o| format!("org:{o}"))
            .chain(self.repos.iter().map(|r| format!("repo:{r}")))
            .collect::<Vec<_>>()
            .join(" ")
    }
}

// ---------- model ----------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Column {
    DraftMine,
    ReviewMine,
    ReadyToMergeMine,
    WaitingOnMe,
    WaitingOnAuthor,
}

impl Column {
    pub const ALL: [Column; 5] = [
        Column::WaitingOnMe,
        Column::ReviewMine,
        Column::ReadyToMergeMine,
        Column::DraftMine,
        Column::WaitingOnAuthor,
    ];

    pub fn id(self) -> &'static str {
        match self {
            Column::DraftMine => "draftMine",
            Column::ReviewMine => "reviewMine",
            Column::ReadyToMergeMine => "readyToMergeMine",
            Column::WaitingOnMe => "waitingOnMe",
            Column::WaitingOnAuthor => "waitingOnAuthor",
        }
    }

    pub fn title(self) -> &'static str {
        match self {
            Column::DraftMine => "My drafts",
            Column::ReviewMine => "Mine, in review",
            Column::ReadyToMergeMine => "Mine, ready to merge",
            Column::WaitingOnMe => "Waiting on me",
            Column::WaitingOnAuthor => "Waiting on author",
        }
    }

    /// `draftMine`, `draft-mine` or `draft_mine`.
    pub fn parse(s: &str) -> Option<Column> {
        let key: String = s
            .chars()
            .filter(|c| c.is_ascii_alphanumeric())
            .collect::<String>()
            .to_ascii_lowercase();
        Column::ALL
            .into_iter()
            .find(|c| c.id().to_ascii_lowercase() == key)
    }
}

/// Your latest review of someone else's PR.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MyReview {
    /// `approved` · `changesRequested` · `commented` · `dismissed` · `pending`
    pub state: String,
    /// ms epoch.
    pub at: Option<i64>,
    /// The head moved since that review.
    pub new_commits: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pr {
    pub column: Column,
    pub owner: String,
    pub repo: String,
    pub number: u64,
    pub title: String,
    pub url: String,
    pub author: String,
    pub draft: bool,
    /// ms epoch.
    pub created_at: i64,
    pub updated_at: i64,
    pub additions: u64,
    pub deletions: u64,
    pub changed_files: u64,
    /// `XS` · `S` · `M` · `L` · `XL` by lines changed.
    pub size: String,
    pub base_branch: String,
    pub head_branch: String,
    pub head_oid: Option<String>,
    /// `approved` · `changesRequested` · `reviewRequired`; `None` when the repo requires none.
    pub review_decision: Option<String>,
    /// Combined CI state of the head commit: `success` · `failure` · `error` · `pending` ·
    /// `expected`; `None` when nothing reports.
    pub checks: Option<String>,
    pub comments: u64,
    /// Users and teams (`@org/slug`) asked to review.
    pub requested_reviewers: Vec<String>,
    pub my_review: Option<MyReview>,
    /// Joined at read time, never cached: where the repo and the head branch are checked out.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local: Option<Local>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Local {
    /// The checkout under the `fleet repos` roots.
    pub repo_path: String,
    /// The worktree (or the main checkout) that has the head branch checked out.
    pub worktree: Option<String>,
}

pub fn size_label(lines: u64) -> &'static str {
    match lines {
        0..=10 => "XS",
        11..=100 => "S",
        101..=500 => "M",
        501..=1000 => "L",
        _ => "XL",
    }
}

/// `CHANGES_REQUESTED` → `changesRequested`.
fn camel(s: &str) -> String {
    let mut out = String::new();
    for (i, part) in s.split('_').filter(|p| !p.is_empty()).enumerate() {
        let lower = part.to_ascii_lowercase();
        if i == 0 {
            out.push_str(&lower);
        } else {
            let mut c = lower.chars();
            if let Some(f) = c.next() {
                out.push(f.to_ascii_uppercase());
                out.extend(c);
            }
        }
    }
    out
}

fn ms(v: &Value) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(v.as_str()?)
        .ok()
        .map(|d| d.timestamp_millis())
}

fn str_at<'a>(v: &'a Value, path: &[&str]) -> Option<&'a str> {
    path.iter().try_fold(v, |v, k| v.get(k))?.as_str()
}

/// One search node → a [`Pr`] in `column`. `None` for anything that isn't a pull request.
fn parse_node(n: &Value, column: Column, me: &str) -> Option<Pr> {
    let number = n.get("number")?.as_u64()?;
    let additions = n["additions"].as_u64().unwrap_or(0);
    let deletions = n["deletions"].as_u64().unwrap_or(0);
    let head = n["commits"]["nodes"]
        .as_array()
        .and_then(|a| a.last())
        .map(|c| &c["commit"]);
    let head_oid = head.and_then(|c| c["oid"].as_str()).map(String::from);
    let checks = head
        .and_then(|c| c["statusCheckRollup"]["state"].as_str())
        .map(camel);
    let requested_reviewers = n["reviewRequests"]["nodes"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|r| {
                    let r = &r["requestedReviewer"];
                    r["login"]
                        .as_str()
                        .map(String::from)
                        .or_else(|| r["slug"].as_str().map(|s| format!("@{s}")))
                })
                .collect()
        })
        .unwrap_or_default();
    let my_review = n["latestReviews"]["nodes"].as_array().and_then(|a| {
        a.iter()
            .find(|r| str_at(r, &["author", "login"]).is_some_and(|l| l.eq_ignore_ascii_case(me)))
            .map(|r| MyReview {
                state: camel(r["state"].as_str().unwrap_or("")),
                at: ms(&r["submittedAt"]),
                new_commits: match (str_at(r, &["commit", "oid"]), head_oid.as_deref()) {
                    (Some(seen), Some(now)) => seen != now,
                    _ => false,
                },
            })
    });
    Some(Pr {
        column,
        owner: str_at(n, &["repository", "owner", "login"])?.to_string(),
        repo: str_at(n, &["repository", "name"])?.to_string(),
        number,
        title: n["title"].as_str().unwrap_or("").to_string(),
        url: n["url"].as_str().unwrap_or("").to_string(),
        author: str_at(n, &["author", "login"])
            .unwrap_or("ghost")
            .to_string(),
        draft: n["isDraft"].as_bool().unwrap_or(false),
        created_at: ms(&n["createdAt"]).unwrap_or(0),
        updated_at: ms(&n["updatedAt"]).unwrap_or(0),
        additions,
        deletions,
        changed_files: n["changedFiles"].as_u64().unwrap_or(0),
        size: size_label(additions + deletions).into(),
        base_branch: n["baseRefName"].as_str().unwrap_or("").to_string(),
        head_branch: n["headRefName"].as_str().unwrap_or("").to_string(),
        head_oid,
        review_decision: n["reviewDecision"].as_str().map(camel),
        checks,
        comments: n["comments"]["totalCount"].as_u64().unwrap_or(0),
        requested_reviewers,
        my_review,
        local: None,
    })
}

/// The three searches' nodes → one list, each PR once, in its column. A PR in several
/// searches goes to the first that claims it: yours, then asked of you, then reviewed by you.
pub fn classify(me: &str, mine: &[Value], requested: &[Value], reviewed: &[Value]) -> Vec<Pr> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    let mut push = |pr: Pr, out: &mut Vec<Pr>| {
        if seen.insert(pr.url.clone()) {
            out.push(pr);
        }
    };
    for n in mine {
        if let Some(mut pr) = parse_node(n, Column::DraftMine, me) {
            pr.column = if pr.draft {
                Column::DraftMine
            } else if pr.review_decision.as_deref() == Some("approved") {
                Column::ReadyToMergeMine
            } else {
                Column::ReviewMine
            };
            push(pr, &mut out);
        }
    }
    for n in requested {
        if let Some(pr) = parse_node(n, Column::WaitingOnMe, me) {
            push(pr, &mut out);
        }
    }
    for n in reviewed {
        if let Some(pr) = parse_node(n, Column::WaitingOnAuthor, me) {
            // Approved by you: nothing left for you to do or wait on.
            if pr.my_review.as_ref().is_some_and(|r| r.state == "approved") {
                continue;
            }
            push(pr, &mut out);
        }
    }
    out.sort_by_key(|p| {
        (
            Column::ALL.iter().position(|c| *c == p.column),
            std::cmp::Reverse(p.updated_at),
        )
    });
    out
}

// ---------- fetch ----------

const FIELDS: &str = r#"
fragment pr on PullRequest {
  number title url isDraft createdAt updatedAt additions deletions changedFiles
  baseRefName headRefName reviewDecision
  repository { name owner { login } }
  author { login }
  comments { totalCount }
  commits(last: 1) { nodes { commit { oid statusCheckRollup { state } } } }
  reviewRequests(first: 20) { nodes { requestedReviewer { ... on User { login } ... on Team { slug } } } }
  latestReviews(first: 20) { nodes { author { login } state submittedAt commit { oid } } }
}"#;

fn query() -> String {
    format!(
        "query($q: String!, $first: Int!, $after: String) {{
  viewer {{ login }}
  search(query: $q, type: ISSUE, first: $first, after: $after) {{
    issueCount
    pageInfo {{ hasNextPage endCursor }}
    nodes {{ ...pr }}
  }}
}}{FIELDS}"
    )
}

/// `$FLEET_GH`, then config `gh`, then PATH + fallbacks.
pub fn gh_bin() -> String {
    if let Some(p) = std::env::var_os("FLEET_GH").filter(|p| !p.is_empty()) {
        return p.to_string_lossy().into_owned();
    }
    let cfg = crate::core::config::load().raw["gh"]
        .as_str()
        .map(String::from);
    tools::resolve_binary("gh", cfg.as_deref())
}

/// One search, every page (up to [`MAX_PAGES`]). → (viewer login, nodes, truncated).
fn search(gh: &str, q: &str) -> Result<(String, Vec<Value>, bool)> {
    let query = query();
    let mut nodes = Vec::new();
    let mut after: Option<String> = None;
    let mut login = String::new();
    for _ in 0..MAX_PAGES {
        let mut c = Command::new(gh);
        c.args(["api", "graphql", "-f"])
            .arg(format!("query={query}"))
            .arg("-f")
            .arg(format!("q={q}"))
            .arg("-F")
            .arg(format!("first={PAGE}"))
            .env("PATH", tools::search_path())
            .env("GH_PROMPT_DISABLED", "1")
            .stdin(std::process::Stdio::null());
        if let Some(a) = &after {
            c.arg("-f").arg(format!("after={a}"));
        }
        let o = repos::output_with_timeout(c, GH_TIMEOUT).map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                Error::exit(
                    1,
                    "gh not found: install the GitHub CLI and run `gh auth login`",
                )
            } else {
                Error::Other(format!("gh: {e}"))
            }
        })?;
        if !o.status.success() {
            let err = String::from_utf8_lossy(&o.stderr);
            let line = err.lines().map(str::trim).find(|l| !l.is_empty());
            return Err(Error::Other(format!(
                "gh api graphql failed: {}",
                line.unwrap_or("no output")
            )));
        }
        let v: Value = serde_json::from_slice(&o.stdout)?;
        if let Some(e) = v["errors"].as_array().and_then(|a| a.first()) {
            return Err(Error::Other(format!(
                "GitHub: {}",
                e["message"].as_str().unwrap_or("query failed")
            )));
        }
        login = v["data"]["viewer"]["login"]
            .as_str()
            .unwrap_or_default()
            .to_string();
        let s = &v["data"]["search"];
        nodes.extend(s["nodes"].as_array().cloned().unwrap_or_default());
        if !s["pageInfo"]["hasNextPage"].as_bool().unwrap_or(false) {
            return Ok((login, nodes, false));
        }
        after = s["pageInfo"]["endCursor"].as_str().map(String::from);
    }
    Ok((login, nodes, true))
}

/// What one fetch produced (also the cache file's shape).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Snapshot {
    pub version: u32,
    /// Your GitHub login.
    pub user: String,
    /// The search scope this was fetched with ([`Settings::scope`]).
    pub scope: String,
    /// ms epoch.
    pub fetched_at: i64,
    /// A search hit [`MAX_PAGES`] pages; some PRs are missing.
    pub truncated: bool,
    pub prs: Vec<Pr>,
}

/// Run the three searches (in parallel) and classify.
pub fn fetch(s: &Settings, now_ms: i64) -> Result<Snapshot> {
    let gh = gh_bin();
    let scope = s.scope();
    let base = "is:pr is:open archived:false";
    let qs = [
        format!("{base} author:@me {scope}"),
        format!("{base} user-review-requested:@me {scope}"),
        format!("{base} reviewed-by:@me -author:@me {scope}"),
    ];
    let results: Vec<Result<(String, Vec<Value>, bool)>> = std::thread::scope(|sc| {
        let hs: Vec<_> = qs
            .iter()
            .map(|q| {
                let gh = &gh;
                sc.spawn(move || search(gh, q.trim()))
            })
            .collect();
        hs.into_iter()
            .map(|h| {
                h.join()
                    .unwrap_or_else(|_| Err(Error::Other("search thread panicked".into())))
            })
            .collect()
    });
    let mut parts = Vec::new();
    for r in results {
        parts.push(r?);
    }
    let user = parts[0].0.clone();
    let truncated = parts.iter().any(|p| p.2);
    let prs = classify(&user, &parts[0].1, &parts[1].1, &parts[2].1);
    Ok(Snapshot {
        version: 1,
        user,
        scope,
        fetched_at: now_ms,
        truncated,
        prs,
    })
}

// ---------- cache ----------

pub fn cache_path() -> PathBuf {
    if let Some(p) = std::env::var_os("FLEET_PRS_CACHE").filter(|p| !p.is_empty()) {
        return PathBuf::from(tools::expand_tilde(&p.to_string_lossy()));
    }
    let base = std::env::var_os("XDG_CACHE_HOME")
        .filter(|p| !p.is_empty())
        .map(|p| PathBuf::from(tools::expand_tilde(&p.to_string_lossy())))
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_default().join(".cache"));
    base.join("fleet").join("prs.json")
}

pub fn load_cache(path: &Path) -> Option<Snapshot> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
}

pub fn save_cache(path: &Path, snap: &Snapshot) -> Result<()> {
    if let Some(d) = path.parent() {
        std::fs::create_dir_all(d)?;
    }
    let tmp = path.with_extension(format!("json.{}.tmp", std::process::id()));
    std::fs::write(&tmp, serde_json::to_string(snap)? + "\n")?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum Mode {
    /// Fetch when the cache is older than `prs.refresh` (or missing, or for another scope).
    #[default]
    Auto,
    /// Always fetch.
    Refresh,
    /// Never fetch.
    Cached,
}

/// What `fleet prs` shows: a snapshot, how it was obtained, and what went wrong.
#[derive(Debug, Clone)]
pub struct View {
    pub snap: Snapshot,
    /// Older than `prs.refresh` (a fetch failed, or `Mode::Cached`).
    pub stale: bool,
    /// The fetch that failed, when the cache is served instead.
    pub error: Option<String>,
}

/// Cache-or-fetch per `mode`. Errors only when there is nothing to show.
pub fn get(s: &Settings, mode: Mode, now_ms: i64) -> Result<View> {
    let path = cache_path();
    let cached = load_cache(&path).filter(|c| c.version == 1 && c.scope == s.scope());
    let fresh = |c: &Snapshot| now_ms - c.fetched_at < s.refresh * 1000;
    let want = match (&cached, mode) {
        (_, Mode::Refresh) | (None, Mode::Auto) => true,
        (Some(c), Mode::Auto) => !fresh(c),
        (_, Mode::Cached) => false,
    };
    if want {
        match fetch(s, now_ms) {
            Ok(snap) => {
                save_cache(&path, &snap)?;
                return Ok(View {
                    snap,
                    stale: false,
                    error: None,
                });
            }
            Err(e) => match cached {
                Some(c) => {
                    return Ok(View {
                        snap: c,
                        stale: true,
                        error: Some(e.to_string()),
                    });
                }
                None => return Err(e),
            },
        }
    }
    match cached {
        Some(c) => Ok(View {
            stale: !fresh(&c),
            snap: c,
            error: None,
        }),
        None => Err(Error::exit(
            1,
            "no cached pull requests yet: run `fleet prs` without --cached",
        )),
    }
}

// ---------- local ----------

/// `git worktree list --porcelain` → (branch, path) for every worktree on a branch.
fn worktrees(repo: &Path) -> Vec<(String, String)> {
    let Some(out) = repos::git(repo, &["worktree", "list", "--porcelain"]) else {
        return Vec::new();
    };
    let mut res = Vec::new();
    let mut path: Option<String> = None;
    for line in out.lines() {
        if let Some(p) = line.strip_prefix("worktree ") {
            path = Some(p.to_string());
        } else if let Some(b) = line.strip_prefix("branch refs/heads/")
            && let Some(p) = &path
        {
            res.push((b.to_string(), p.clone()));
        }
    }
    res
}

/// Does `repo`'s `origin` point at `owner/name` on some host?
fn origin_is(repo: &Path, owner: &str, name: &str) -> bool {
    let Some(url) = repos::git(repo, &["remote", "get-url", "origin"]) else {
        return false;
    };
    let url = url.trim_end_matches('/').trim_end_matches(".git");
    let want = format!("{owner}/{name}").to_ascii_lowercase();
    let url = url.to_ascii_lowercase();
    url.ends_with(&format!("/{want}")) || url.ends_with(&format!(":{want}"))
}

/// A repo's path and its (branch, worktree path) pairs.
type Checkout = (PathBuf, Vec<(String, String)>);

/// Fill in [`Pr::local`] from the `fleet repos` checkouts: the repo whose directory name is
/// the PR's repo name (and, when two share it, whose `origin` is the PR's repo), and the
/// worktree that has the head branch. Repos are matched once each, not once per PR.
pub fn link_local(prs: &mut [Pr], roots: &repos::Settings) {
    let all = repos::discover(roots);
    let mut found: HashMap<(String, String), Option<Checkout>> = HashMap::new();
    for pr in prs.iter_mut() {
        let key = (pr.owner.clone(), pr.repo.clone());
        let hit = found.entry(key).or_insert_with(|| {
            let named: Vec<&repos::Repo> = all
                .iter()
                .filter(|r| r.name.eq_ignore_ascii_case(&pr.repo))
                .collect();
            let repo = match named.len() {
                0 => None,
                1 => Some(named[0]),
                _ => named
                    .iter()
                    .copied()
                    .find(|r| origin_is(&r.path, &pr.owner, &pr.repo)),
            }?;
            Some((repo.path.clone(), worktrees(&repo.path)))
        });
        if let Some((path, wts)) = hit {
            pr.local = Some(Local {
                repo_path: path.display().to_string(),
                worktree: wts
                    .iter()
                    .find(|(b, _)| *b == pr.head_branch)
                    .map(|(_, p)| p.clone()),
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn node(repo: &str, number: u64, extra: Value) -> Value {
        let mut n = json!({
            "number": number,
            "title": format!("PR {number}"),
            "url": format!("https://github.com/acme/{repo}/pull/{number}"),
            "isDraft": false,
            "createdAt": "2026-10-01T10:00:00Z",
            "updatedAt": "2026-10-02T10:00:00Z",
            "additions": 40, "deletions": 20, "changedFiles": 3,
            "baseRefName": "main", "headRefName": format!("feat-{number}"),
            "reviewDecision": "REVIEW_REQUIRED",
            "repository": { "name": repo, "owner": { "login": "acme" } },
            "author": { "login": "someone" },
            "comments": { "totalCount": 2 },
            "commits": { "nodes": [ { "commit": { "oid": "head1", "statusCheckRollup": { "state": "SUCCESS" } } } ] },
            "reviewRequests": { "nodes": [] },
            "latestReviews": { "nodes": [] }
        });
        if let (Some(o), Some(e)) = (n.as_object_mut(), extra.as_object()) {
            for (k, v) in e {
                o.insert(k.clone(), v.clone());
            }
        }
        n
    }

    #[test]
    fn settings_scope_and_problems() {
        let s = Settings::from_value(&Value::Null);
        assert_eq!(s.scope(), "");
        assert_eq!(s.refresh, 300);
        let s = Settings::from_value(&json!({
            "orgs": ["acme", "has space", 3], "repos": ["x/y"], "refresh": "10s"
        }));
        assert_eq!(s.scope(), "org:acme repo:x/y");
        assert_eq!(s.refresh, 300);
        assert_eq!(s.problems.len(), 3, "{:?}", s.problems);
    }

    #[test]
    fn columns_parse_any_spelling() {
        assert_eq!(Column::parse("draft-mine"), Some(Column::DraftMine));
        assert_eq!(Column::parse("waiting_on_me"), Some(Column::WaitingOnMe));
        assert_eq!(
            Column::parse("readyToMergeMine"),
            Some(Column::ReadyToMergeMine)
        );
        assert_eq!(Column::parse("nope"), None);
    }

    #[test]
    fn classify_sorts_mine_requested_and_reviewed() {
        let me = "me";
        let mine = vec![
            node(
                "app",
                1,
                json!({ "isDraft": true, "author": { "login": "me" } }),
            ),
            node("app", 2, json!({ "author": { "login": "me" } })),
            node(
                "app",
                3,
                json!({ "author": { "login": "me" }, "reviewDecision": "APPROVED" }),
            ),
        ];
        let requested = vec![
            node(
                "api",
                10,
                json!({
                    "reviewRequests": { "nodes": [
                        { "requestedReviewer": { "login": "me" } },
                        { "requestedReviewer": { "slug": "backend" } }
                    ] }
                }),
            ),
            // Also yours: stays in your column.
            node("app", 2, json!({ "author": { "login": "me" } })),
        ];
        let reviewed = vec![
            node(
                "api",
                20,
                json!({ "latestReviews": { "nodes": [
                { "author": { "login": "ME" }, "state": "CHANGES_REQUESTED",
                  "submittedAt": "2026-10-02T09:00:00Z", "commit": { "oid": "old" } }
            ] } }),
            ),
            node(
                "api",
                21,
                json!({ "latestReviews": { "nodes": [
                { "author": { "login": "me" }, "state": "APPROVED", "commit": { "oid": "head1" } }
            ] } }),
            ),
            // Re-requested after your review: waiting on you, not the author.
            node("api", 10, json!({})),
        ];
        let prs = classify(me, &mine, &requested, &reviewed);
        let cols: Vec<(u64, Column)> = prs.iter().map(|p| (p.number, p.column)).collect();
        assert_eq!(
            cols,
            vec![
                (10, Column::WaitingOnMe),
                (2, Column::ReviewMine),
                (3, Column::ReadyToMergeMine),
                (1, Column::DraftMine),
                (20, Column::WaitingOnAuthor),
            ]
        );
        let p10 = &prs[0];
        assert_eq!(p10.requested_reviewers, vec!["me", "@backend"]);
        assert_eq!(p10.checks.as_deref(), Some("success"));
        assert_eq!(p10.review_decision.as_deref(), Some("reviewRequired"));
        assert_eq!(p10.size, "S");
        let p20 = prs.iter().find(|p| p.number == 20).unwrap();
        let r = p20.my_review.as_ref().unwrap();
        assert_eq!(r.state, "changesRequested");
        assert!(r.new_commits);
    }

    #[test]
    fn non_pr_nodes_are_skipped() {
        let prs = classify("me", &[json!({}), json!({ "number": 1 })], &[], &[]);
        assert!(prs.is_empty());
    }

    #[test]
    fn sizes() {
        assert_eq!(size_label(0), "XS");
        assert_eq!(size_label(100), "S");
        assert_eq!(size_label(500), "M");
        assert_eq!(size_label(1000), "L");
        assert_eq!(size_label(1001), "XL");
    }

    #[test]
    fn link_local_finds_repo_and_worktree() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("code");
        let repo = root.join("app");
        std::fs::create_dir_all(&repo).unwrap();
        let git = |dir: &Path, args: &[&str]| {
            let ok = Command::new("git")
                .current_dir(dir)
                .args(args)
                .env("GIT_CONFIG_GLOBAL", "/dev/null")
                .output()
                .unwrap()
                .status
                .success();
            assert!(ok, "git {args:?}");
        };
        git(&repo, &["init", "-q", "-b", "main"]);
        git(
            &repo,
            &[
                "-c",
                "user.name=t",
                "-c",
                "user.email=t@t",
                "commit",
                "-q",
                "--allow-empty",
                "-m",
                "x",
            ],
        );
        let wt = tmp.path().join("wt-feat-2");
        git(
            &repo,
            &[
                "worktree",
                "add",
                "-q",
                "-b",
                "feat-2",
                wt.to_str().unwrap(),
            ],
        );

        let roots = repos::Settings::from_value(&json!({ "roots": [root.to_str().unwrap()] }));
        let mut prs = classify(
            "me",
            &[node("app", 2, json!({})), node("other", 3, json!({}))],
            &[],
            &[],
        );
        link_local(&mut prs, &roots);
        let p2 = prs.iter().find(|p| p.number == 2).unwrap();
        let local = p2.local.as_ref().unwrap();
        assert_eq!(local.repo_path, repo.display().to_string());
        let wt_real = std::fs::canonicalize(&wt).unwrap();
        let got = std::fs::canonicalize(local.worktree.as_ref().unwrap()).unwrap();
        assert_eq!(got, wt_real);
        assert!(prs.iter().find(|p| p.number == 3).unwrap().local.is_none());
    }
}
