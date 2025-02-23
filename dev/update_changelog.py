import re
import os
import subprocess
from datetime import datetime
from collections import defaultdict
from pathlib import Path
from typing import NamedTuple, List, Any

import click
import requests


def get_header_for_version(version):
    return "## {} ({})".format(version, datetime.now().strftime("%Y-%m-%d"))


def extract_pr_num_from_git_log_entry(git_log_entry):
    m = re.search(r"\(#(\d+)\)$", git_log_entry)
    return int(m.group(1)) if m else None


class PullRequest(NamedTuple):
    title: str
    number: int
    author: str
    labels: List[str]

    @property
    def url(self):
        return f"https://github.com/mlflow/mlflow/pull/{self.number}"

    @property
    def release_note_labels(self):
        return [l for l in self.labels if l.startswith("rn/")]

    def __str__(self):
        return f"{self.title} (#{self.number}, @{self.author})"

    def __repr__(self):
        return str(self)


class Section(NamedTuple):
    title: str
    items: List[Any]

    def __str__(self):
        if not self.items:
            return ""
        return "\n\n".join(
            [
                self.title,
                "\n".join(f"- {item}" for item in self.items),
            ]
        )


@click.command(help="Update CHANGELOG.md")
@click.option(
    "--prev-branch",
    required=True,
    help="Previous release branch to compare to, e.g. branch-0.8",
)
@click.option(
    "--curr-branch",
    default="master",
    help="Current release (candidate) branch to compare to, e.g. branch-0.9 (default: 'master').",
)
@click.option("--release-version", required=True, help=("MLflow version to release."))
def main(prev_branch, curr_branch, release_version):
    git_log_output = subprocess.check_output(
        [
            "git",
            "log",
            "--left-right",
            "--graph",
            "--cherry-pick",
            "--pretty=format:%s",
            f"origin/{prev_branch}...origin/{curr_branch}",
        ],
        text=True,
    )
    logs = [l[2:] for l in git_log_output.splitlines() if l.startswith("> ")]
    prs = []
    for log in logs:
        pr_num = extract_pr_num_from_git_log_entry(log)
        if not pr_num:
            continue
        print(f"Fetching PR #{pr_num}...")
        resp = requests.get(
            f"https://api.github.com/repos/mlflow/mlflow/pulls/{pr_num}",
            auth=("mlflow-automation", os.getenv("GITHUB_TOKEN")),
        )
        resp.raise_for_status()
        pr = resp.json()
        prs.append(
            PullRequest(
                title=log.rsplit(maxsplit=1)[0],
                number=pr_num,
                author=pr["user"]["login"],
                labels=[l["name"] for l in pr["labels"]],
            )
        )

    label_to_prs = defaultdict(list)
    author_to_prs = defaultdict(list)
    unlabelled_prs = []
    for pr in prs:
        if pr.author == "mlflow-automation":
            continue

        if len(pr.release_note_labels) == 0:
            unlabelled_prs.append(pr)

        for label in pr.release_note_labels:
            if label == "rn/none":
                author_to_prs[pr.author].append(pr)
            else:
                label_to_prs[label].append(pr)

    assert len(unlabelled_prs) == 0, "The following PRs need to be categorized:\n" + "\n".join(
        f"- {pr.url}" for pr in unlabelled_prs
    )

    unknown_labels = set(label_to_prs.keys()) - {
        "rn/feature",
        "rn/breaking-change",
        "rn/bug-fix",
        "rn/documentation",
        "rn/none",
    }
    assert len(unknown_labels) == 0, f"Unknown labels: {unknown_labels}"

    breaking_changes = Section("Breaking changes:", label_to_prs.get("rn/breaking_change", []))
    features = Section("Features:", label_to_prs.get("rn/feature", []))
    bug_fixes = Section("Bug fixes:", label_to_prs.get("rn/bug-fix", []))
    doc_updates = Section("Documentation updates:", label_to_prs.get("rn/documentation", []))
    small_updates = [
        ", ".join([f"#{pr.number}" for pr in prs] + [f"@{author}"])
        for author, prs in author_to_prs.items()
    ]
    small_updates = "Small bug fixes and documentation updates:\n\n" + "; ".join(small_updates)
    sections = filter(
        str.strip,
        map(
            str,
            [
                get_header_for_version(release_version),
                f"MLflow {release_version} includes several major features and improvements",
                breaking_changes,
                features,
                bug_fixes,
                doc_updates,
                small_updates,
            ],
        ),
    )
    new_changelog = "\n\n".join(sections)
    changelog_header = "# CHANGELOG"
    changelog = Path("CHANGELOG.md")
    old_changelog = changelog.read_text().replace(f"{changelog_header}\n\n", "", 1)
    new_changelog = "\n\n".join(
        [
            changelog_header,
            new_changelog,
            old_changelog,
        ]
    )
    changelog.write_text(new_changelog)


if __name__ == "__main__":
    main()  # pylint: disable=no-value-for-parameter
