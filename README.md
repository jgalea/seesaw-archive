<div align="center">

# seesaw-archive

[![License](https://img.shields.io/badge/LICENSE-MIT-5C9E31?style=for-the-badge)](LICENSE)
[![Built by](https://img.shields.io/badge/BUILT%20BY-REBELCODE-8A2BE2?style=for-the-badge)](https://rebelcode.com)

**Download your children's Seesaw journal archives with real filenames, organized into a folder per child.**

</div>

## The problem

Seesaw lets you download a journal archive per class, but every file comes down as `Seesaw - <child>.zip`. A parent with two kids and six years of classes ends up with a folder of identically named zips and no way to tell which is which. The archives are also prepared one at a time on Seesaw's side, so clicking through them by hand means babysitting the browser for an hour.

## What it does

Walks to the Journal Archives list, reads every archive on the account, and downloads them one at a time into:

```
~/Downloads/Seesaw Archives/
├── Ada_Ross/
│   ├── Ada_Ross_Gross_Motor_PK4-A_2023-24.zip
│   └── Ada_Ross_Reception_B_2024-25.zip
└── Sam_Ross/
    └── Sam_Ross_Year_1_A_2024-25.zip
```

It records what it fetched, so re-running picks up where it stopped instead of starting over.

## Install

```sh
git clone <this repo> && cd seesaw-archive
npm install
npm link          # optional, puts `seesaw-archive` on your PATH
```

Node 20 or newer.

## Use

```sh
seesaw-archive login       # opens a window, you sign in yourself
seesaw-archive list        # see what's on the account
seesaw-archive download    # fetch everything
```

Useful flags:

```sh
seesaw-archive download --dry-run              # show the plan, fetch nothing
seesaw-archive download --child Ada            # one child only
seesaw-archive download --out ~/Archive/Kids   # somewhere else
seesaw-archive download --force                # re-fetch things already done
seesaw-archive list --json                     # machine-readable
```

## About your password

`login` opens a normal browser window and waits for you to sign in. You type your own password; the tool never asks for it, never receives it, and never stores it. What it saves is the session cookie, in `~/.seesaw-archive/state.json` with owner-only permissions. `seesaw-archive logout` deletes it.

Sessions expire after a while. When that happens, commands say so and you run `login` again.

## Why it downloads slowly

Seesaw builds each zip on its servers after you click, then redirects to the finished file. Clicking several at once makes it cancel downloads or silently email you a link instead. So this fetches strictly one at a time and waits for each file to land, which is slower but actually finishes. Archives run 40-50 MB each, so a full account can be a gigabyte and take a while.

## Notes

- Reads only. It downloads archives and changes nothing in your Seesaw account.
- Each saved file is checked against the class id in Seesaw's own download URL, so a zip can't quietly end up under the wrong child.
- Archives that look empty are skipped; pass `--include-empty` to fetch them anyway.

## If it can't find the archive list

Seesaw is a single-page app and moves its account settings around from time to time. If the walk fails, open the list yourself in the window it left open (account menu → Account Settings → Download Journal Archives) and run:

```sh
seesaw-archive debug --json
```

That writes what the page actually looks like, which is what's needed to re-pin the selectors.
