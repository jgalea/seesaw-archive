<div align="center">

# seesaw-archive

[seesaw-archive CLI](https://github.com/jgalea/seesaw-archive) | [Chrome extension](https://github.com/jgalea/seesaw-downloader)

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

By default it shows you what it's about to fetch and asks before starting.

### Choosing what to download

With several children and a few years each, an account can hold thirty-odd archives. Three ways to narrow it down:

Pick from a menu:

```sh
seesaw-archive download --pick
```

```
  Ada Ross
    1. Art PK4-A 2023-24
    2. Gross Motor PK4-A 2023-24
    3. Homeroom K5-A 2024-25

  Sam Ross
    4. Art PK3-A 2024-25
    5. Music PK3-A 2024-25

  Pick by number (1-3,7), by child or year (Ada, 2024-25), or "all".
  Which ones? (empty to cancel):
```

Or say it up front:

```sh
seesaw-archive download --child Ada                    # one child
seesaw-archive download --year 2024-25                 # one school year
seesaw-archive download --child Ada --year 2024-25     # both at once
seesaw-archive download --child Ada --child Sam        # repeatable
```

`--year` takes `2024-25`, `2024-2025`, or either single year on its own. `seesaw-archive list` prints which years the account actually has.

Other flags:

```sh
seesaw-archive download --dry-run              # show the plan, fetch nothing
seesaw-archive download --yes                  # skip the confirmation
seesaw-archive download --limit 3              # stop after three
seesaw-archive download --out ~/Archive/Kids   # somewhere else
seesaw-archive download --force                # re-fetch things already done
seesaw-archive list --json                     # machine-readable
```

## About your password

`login` opens a normal browser window and waits for you to sign in. You type your own password; the tool never asks for it, never receives it, and never stores it. What it saves is the session cookie, in `~/.seesaw-archive/state.json` with owner-only permissions. `seesaw-archive logout` deletes it.

Sessions expire after a while. When that happens, commands say so and you run `login` again.

## Why it downloads slowly

Seesaw builds each zip on its servers after you click, then redirects to the finished file. Clicking several at once makes it cancel downloads or silently email you a link instead. So this fetches strictly one at a time and waits for each file to land, which is slower but actually finishes. Archives run 40-50 MB each, so a full account can be a gigabyte and take a while.

## Not comfortable with a terminal?

There's a [Chrome extension](https://github.com/jgalea/seesaw-downloader) that does the naming part without any of this. You still click each archive yourself in Seesaw, but each one saves under a proper name. This CLI is the version that walks a whole account unattended.

## Unofficial

Not affiliated with or endorsed by Seesaw. It signs in as you and downloads the archives your own account already offers through its interface, nothing else. Seesaw reshuffles their site from time to time, and when they do, this needs a fix before it works again.

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
