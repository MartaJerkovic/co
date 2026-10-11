//! `fleet prs` against a fake `gh` (FLEET_GH): columns, the cache, a failing fetch.

mod common;

use std::os::unix::fs::PermissionsExt;

use common::Env;
use serde_json::{Value, json};

fn pr(repo: &str, number: u64, author: &str, draft: bool, reviews: Value) -> Value {
    json!({
        "number": number,
        "title": format!("PR {number}"),
        "url": format!("https://github.com/acme/{repo}/pull/{number}"),
        "isDraft": draft,
        "createdAt": "2026-10-01T10:00:00Z",
        "updatedAt": "2026-10-02T10:00:00Z",
        "additions": 5, "deletions": 1, "changedFiles": 1,
        "baseRefName": "main", "headRefName": format!("b{number}"),
        "reviewDecision": null,
        "repository": { "name": repo, "owner": { "login": "acme" } },
        "author": { "login": author },
        "comments": { "totalCount": 0 },
        "commits": { "nodes": [ { "commit": { "oid": "h", "statusCheckRollup": { "state": "PENDING" } } } ] },
        "reviewRequests": { "nodes": [] },
        "latestReviews": { "nodes": reviews }
    })
}

fn page(nodes: Vec<Value>) -> String {
    json!({ "data": {
        "viewer": { "login": "me" },
        "search": { "issueCount": nodes.len(), "pageInfo": { "hasNextPage": false, "endCursor": null }, "nodes": nodes }
    } })
    .to_string()
}

/// A `gh` that answers each of the three searches from a file, logs its calls, and fails
/// while `fail` exists.
fn fake_gh(env: &Env) -> std::path::PathBuf {
    std::fs::write(
        env.path("mine.json"),
        page(vec![
            pr("app", 1, "me", true, json!([])),
            pr("app", 2, "me", false, json!([])),
        ]),
    )
    .unwrap();
    std::fs::write(
        env.path("requested.json"),
        page(vec![pr("api", 10, "ana", false, json!([]))]),
    )
    .unwrap();
    std::fs::write(
        env.path("reviewed.json"),
        page(vec![pr(
            "api",
            20,
            "bo",
            false,
            json!([{ "author": { "login": "me" }, "state": "COMMENTED", "commit": { "oid": "h" } }]),
        )]),
    )
    .unwrap();
    let dir = env.dir.path().display();
    let script = format!(
        r#"#!/bin/sh
echo call >> {dir}/calls
[ -e {dir}/fail ] && {{ echo "HTTP 502" >&2; exit 1; }}
for a in "$@"; do
  case "$a" in
    q=*reviewed-by:@me*) cat {dir}/reviewed.json; exit 0 ;;
    q=*user-review-requested:@me*) cat {dir}/requested.json; exit 0 ;;
    q=*author:@me*) cat {dir}/mine.json; exit 0 ;;
  esac
done
exit 3
"#
    );
    let p = env.path("gh");
    std::fs::write(&p, script).unwrap();
    std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
    p
}

fn cmd(env: &Env, gh: &std::path::Path) -> assert_cmd::Command {
    env.write_config(
        &json!({ "version": 1, "prs": { "orgs": ["acme"] }, "repos": { "roots": [] } }),
    );
    let mut c = env.cmd();
    c.env("FLEET_GH", gh)
        .env("FLEET_PRS_CACHE", env.path("prs.json"));
    c
}

fn calls(env: &Env) -> usize {
    std::fs::read_to_string(env.path("calls"))
        .map(|s| s.lines().count())
        .unwrap_or(0)
}

fn json_of(out: &[u8]) -> Value {
    serde_json::from_slice(out).unwrap()
}

#[test]
fn prs_json_sorts_into_columns_and_caches() {
    let env = Env::new();
    let gh = fake_gh(&env);
    let out = cmd(&env, &gh).args(["prs", "--json"]).assert().success();
    let v = json_of(&out.get_output().stdout);
    assert_eq!(v["user"], "me");
    assert_eq!(v["scope"], "org:acme");
    assert_eq!(v["stale"], false);
    let cols: Vec<(String, String)> = v["prs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| {
            (
                format!("{}#{}", p["repo"].as_str().unwrap(), p["number"]),
                p["column"].as_str().unwrap().to_string(),
            )
        })
        .collect();
    assert_eq!(
        cols,
        vec![
            ("api#10".into(), "waitingOnMe".into()),
            ("app#2".into(), "reviewMine".into()),
            ("app#1".into(), "draftMine".into()),
            ("api#20".into(), "waitingOnAuthor".into()),
        ]
    );
    assert_eq!(v["prs"][0]["checks"], "pending");
    assert_eq!(v["columns"].as_array().unwrap().len(), 5);
    assert_eq!(v["columns"][0]["id"], "waitingOnMe");
    assert_eq!(v["columns"][0]["count"], 1);
    assert_eq!(calls(&env), 3);

    // Fresh cache: no fetch.
    cmd(&env, &gh).args(["prs", "--json"]).assert().success();
    assert_eq!(calls(&env), 3);

    // --column filters, by any spelling.
    let out = cmd(&env, &gh)
        .args(["prs", "--json", "--column", "draft-mine"])
        .assert()
        .success();
    let v = json_of(&out.get_output().stdout);
    assert_eq!(v["prs"].as_array().unwrap().len(), 1);
    assert_eq!(v["columns"].as_array().unwrap().len(), 1);
}

#[test]
fn a_failed_refresh_serves_the_cache_with_the_error() {
    let env = Env::new();
    let gh = fake_gh(&env);
    cmd(&env, &gh).args(["prs", "--json"]).assert().success();
    std::fs::write(env.path("fail"), "").unwrap();
    let out = cmd(&env, &gh)
        .args(["prs", "--json", "--refresh"])
        .assert()
        .success();
    let v = json_of(&out.get_output().stdout);
    assert_eq!(v["stale"], true);
    assert!(v["error"].as_str().unwrap().contains("502"), "{v}");
    assert_eq!(v["prs"].as_array().unwrap().len(), 4);
}

#[test]
fn no_cache_and_a_failing_gh_is_an_error() {
    let env = Env::new();
    let gh = fake_gh(&env);
    std::fs::write(env.path("fail"), "").unwrap();
    cmd(&env, &gh)
        .args(["prs"])
        .assert()
        .failure()
        .stderr(predicates::str::contains("502"));
    cmd(&env, &gh)
        .args(["prs", "--cached"])
        .assert()
        .failure()
        .stderr(predicates::str::contains("no cached pull requests"));
}

#[test]
fn unknown_column_is_a_usage_error() {
    let env = Env::new();
    let gh = fake_gh(&env);
    cmd(&env, &gh)
        .args(["prs", "--column", "nope"])
        .assert()
        .code(2)
        .stderr(predicates::str::contains("waitingOnMe"));
}
