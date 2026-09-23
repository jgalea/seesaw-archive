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

Walks to the Journal Archives list, reads every archive on the account, and downloads them one at a time into the Downloads folder in your home directory:

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

Node 20 or newer, on macOS, Linux, or Windows. `npm install` also downloads the Chromium build it drives.

On Linux, Chromium needs a few system libraries. If `login` fails to launch the browser, install them with `sudo npx playwright install-deps chromium`. `login` opens a visible window, so it needs a desktop session; after that, `--headless` works without one.

Tested on macOS, with the unit tests also run on Linux. Windows should work but hasn't been run on a real machine yet.

## Use

```sh
seesaw-archive login       # opens a window, you sign in yourself
seesaw-archive list        # see what's on the account
seesaw-archive download    # fetch everything
seesaw-archive links       # find linked-but-not-included content
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

`login` opens a normal browser window and waits for you to sign in. You type your own password; the tool never asks for it, never receives it, and never stores it. What it saves is the session cookie, in `~/.seesaw-archive/state.json` with owner-only permissions (on Windows that's `%USERPROFILE%\.seesaw-archive\state.json`, protected by your profile folder's access rules). `seesaw-archive logout` deletes it.

Sessions expire after a while. When that happens, commands say so and you run `login` again.

## Why it downloads slowly

Seesaw builds each zip on its servers after you click, then redirects to the finished file. Clicking several at once makes it cancel downloads or silently email you a link instead. So this fetches strictly one at a time and waits for each file to land, which is slower but actually finishes.

Archive sizes vary wildly. On a real two-child account they ran from 8 MB to 6 GB, with 15 GB across 18 archives, so check you have the disk space before starting. A class with a lot of video is what makes the difference.

Some classes have nothing archived in them, which Seesaw only tells you after you ask for the download. Those are recorded and skipped, so re-runs don't ask again.

## The photos that aren't in your archive

This is the part worth knowing about, because the archive gives no sign of it.

When a teacher uploads a Drive folder of trip photos, they post it to Seesaw as a link. Seesaw's export saves that post's preview image, caption, date and tagged students, but not the URL it points to. So a post captioned "All the pictures here!" comes down as a screenshot of a Drive folder listing, with nothing to click and no way to work out where it pointed.

Your archive looks complete. The bulk photo sets are simply absent, and nothing in the files says so.

```sh
seesaw-archive links
```

This opens each class feed in Seesaw and reads the link targets from the live app, which is the only place they exist. It pages each feed back to the beginning, so it reaches the early years and not just this term. Results are grouped by child and class and written to `linked-content.tsv`.

On a real two-child account across four years, this found 110 linked items that the 15 GB archive did not contain, 10 of them Drive folders. A single folder held 331 photos.

To pull that content down, generate a script and run it:

```sh
seesaw-archive links --fetch-script fetch-linked.sh
./fetch-linked.sh
```

It's a bash script, so on Windows run it from Git Bash or WSL with `bash fetch-linked.sh`.

It needs [rclone](https://rclone.org) with a read-only Google Drive remote, which you authorize in your browser:

```sh
rclone config create gdrive drive scope=drive.readonly
```

Expect some failures. Google answers "not found" both for files that were deleted and for files never shared with you, so the two can't be told apart. If something matters, ask the teacher while they're still reachable.

Two more places photos hide, neither of which any archive covers: folders teachers share by email, and Seesaw's Messages section, which is separate from journal posts and isn't part of the export.

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
