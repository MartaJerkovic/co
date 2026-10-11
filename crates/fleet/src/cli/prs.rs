//! `fleet prs`: the open pull requests that need you, by column (see `core::prs`).

use colored::Colorize;

use crate::cli::render::{ago, column, fit, term_width, width_of};
use crate::core::prs::{self, Column, Mode, Pr, Settings};
use crate::core::repos;
use crate::error::{Error, Result};

pub struct Opts {
    pub json: bool,
    pub column: Option<String>,
    pub mode: Mode,
}

fn checks_cell(c: Option<&str>) -> colored::ColoredString {
    match c {
        Some("success") => "✓".green(),
        Some("failure") | Some("error") => "✗".red(),
        Some("pending") | Some("expected") => "●".yellow(),
        _ => " ".normal(),
    }
}

/// `new commits · worktree` and the like.
fn note(pr: &Pr) -> String {
    let mut parts = Vec::new();
    if pr.my_review.as_ref().is_some_and(|r| r.new_commits) {
        parts.push("new commits".to_string());
    }
    if pr.column == Column::WaitingOnMe && pr.draft {
        parts.push("draft".into());
    }
    if pr.local.as_ref().is_some_and(|l| l.worktree.is_some()) {
        parts.push("worktree".into());
    }
    parts.join(" · ")
}

pub fn run(o: Opts) -> Result<()> {
    let s = Settings::load();
    for p in &s.problems {
        eprintln!("{} {p}", "warning:".yellow());
    }
    let only = match &o.column {
        None => None,
        Some(c) => Some(Column::parse(c).ok_or_else(|| {
            let ids: Vec<&str> = Column::ALL.iter().map(|c| c.id()).collect();
            Error::exit(
                2,
                format!("unknown column '{c}' (one of: {})", ids.join(", ")),
            )
        })?),
    };
    let now = chrono::Utc::now().timestamp_millis();
    let mut view = prs::get(&s, o.mode, now)?;
    view.snap.prs.retain(|p| only.is_none_or(|c| p.column == c));
    prs::link_local(&mut view.snap.prs, &repos::Settings::load());

    if o.json {
        let columns: Vec<serde_json::Value> = Column::ALL
            .iter()
            .filter(|c| only.is_none_or(|o| o == **c))
            .map(|c| {
                serde_json::json!({
                    "id": c.id(),
                    "title": c.title(),
                    "count": view.snap.prs.iter().filter(|p| p.column == *c).count(),
                })
            })
            .collect();
        let out = serde_json::json!({
            "user": view.snap.user,
            "scope": view.snap.scope,
            "fetchedAt": view.snap.fetched_at,
            "stale": view.stale,
            "error": view.error,
            "truncated": view.snap.truncated,
            "columns": columns,
            "prs": view.snap.prs,
        });
        println!("{}", serde_json::to_string_pretty(&out)?);
        return Ok(());
    }

    if let Some(e) = &view.error {
        eprintln!(
            "{} {e} — showing the cache from {} ago",
            "warning:".yellow(),
            ago(Some(view.snap.fetched_at))
        );
    }
    if view.snap.truncated {
        eprintln!(
            "{} a search returned more than 200 PRs; some are missing (narrow prs.orgs / prs.repos)",
            "warning:".yellow()
        );
    }
    let width = term_width();
    let refs: Vec<String> = view
        .snap
        .prs
        .iter()
        .map(|p| format!("{}#{}", p.repo, p.number))
        .collect();
    let ref_w = refs.iter().map(|r| width_of(r)).max().unwrap_or(0);
    let mut first = true;
    for c in Column::ALL {
        let rows: Vec<(usize, &Pr)> = view
            .snap
            .prs
            .iter()
            .enumerate()
            .filter(|(_, p)| p.column == c)
            .collect();
        if rows.is_empty() && only != Some(c) {
            continue;
        }
        if !first {
            println!();
        }
        first = false;
        println!("{} {}", c.title().bold(), rows.len().to_string().dimmed());
        let who: Vec<String> = rows
            .iter()
            .map(|(_, p)| match c {
                Column::WaitingOnMe | Column::WaitingOnAuthor => format!("@{}", p.author),
                _ => String::new(),
            })
            .collect();
        let who_w = who.iter().map(|w| width_of(w)).max().unwrap_or(0).min(20);
        for ((i, p), who) in rows.iter().zip(&who) {
            let tail = note(p);
            // ref, checks, size, age, author; the title and the note share what is left.
            let used = 2 + ref_w + 2 + 2 + 3 + 5 + if who_w > 0 { who_w + 2 } else { 0 };
            let title_w = width
                .saturating_sub(
                    used + if tail.is_empty() {
                        0
                    } else {
                        width_of(&tail) + 2
                    },
                )
                .max(10);
            let who_cell = if who_w > 0 {
                format!("{}  ", column(who, who_w))
            } else {
                String::new()
            };
            println!(
                "  {}  {} {} {}  {}{}{}",
                column(&refs[*i], ref_w).cyan(),
                checks_cell(p.checks.as_deref()),
                column(&p.size, 2).dimmed(),
                column(&ago(Some(p.created_at)), 4).dimmed(),
                who_cell.dimmed(),
                fit(&p.title, title_w),
                if tail.is_empty() {
                    String::new()
                } else {
                    format!("  {}", tail.yellow())
                },
            );
        }
    }
    if first {
        println!("No open pull requests need you.");
    }
    let fetched = format!(
        "fetched {} ago as @{}{}",
        ago(Some(view.snap.fetched_at)),
        view.snap.user,
        if view.snap.scope.is_empty() {
            String::new()
        } else {
            format!(" · {}", view.snap.scope)
        }
    );
    println!("\n{}", fetched.dimmed());
    Ok(())
}
