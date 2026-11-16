#!/bin/sh
# GTAgentClinic: one-command local install for macOS and Linux (Windows: see docs/SETUP.md).
#
#   curl -fsSL https://raw.githubusercontent.com/eth-medical-ai-lab/GTAgentClinic/main/scripts/install.sh | sh
#   sh install.sh [folder] [--no-start]          (default folder: ./gtagentclinic)
#
# Checks git and Node.js 22.12+, says whether Claude Code is installed and logged in, clones the game
# (or updates it with git pull when the folder exists), runs npm install, then npm start. The first
# npm start asks once whether the characters may run on your own Claude Code login.
# Nothing is installed system-wide, nothing runs in the background: Ctrl+C stops the game.
#
# GTAGENTCLINIC_REPO=<git url> overrides the repository (a fork, a mirror).

REPO_URL="https://github.com/eth-medical-ai-lab/GTAgentClinic.git"

main() {
  repo=${GTAGENTCLINIC_REPO:-$REPO_URL}
  dir=gtagentclinic
  start=1
  for a in "$@"; do
    case $a in
      --no-start) start=0 ;;
      -h | --help)
        echo "usage: sh install.sh [folder] [--no-start]"
        return 0
        ;;
      -*)
        echo "unknown option: $a (usage: sh install.sh [folder] [--no-start])" >&2
        return 2
        ;;
      *) dir=$a ;;
    esac
  done

  if [ -t 1 ]; then
    b=$(printf '\033[1m') d=$(printf '\033[2m') g=$(printf '\033[32m') y=$(printf '\033[33m') r=$(printf '\033[31m') t=$(printf '\033[36m') n=$(printf '\033[0m')
  else
    b= d= g= y= r= t= n=
  fi
  ok() { printf '  %s●%s %s\n' "$g" "$n" "$1"; }
  note() { printf '  %s◌%s %s\n' "$y" "$n" "$1"; }
  fail() { printf '  %s✗%s %s\n' "$r" "$n" "$1" >&2; }

  printf '\n%s%s  ✚ GTAgentClinic%s%s  local install%s\n\n' "$t" "$b" "$n" "$d" "$n"

  # 1) git
  if ! command -v git >/dev/null 2>&1; then
    fail "git is missing."
    echo "    macOS: xcode-select --install   (or: brew install git)"
    echo "    Linux: your package manager, e.g. sudo apt install git"
    return 1
  fi
  ok "git $(git --version 2>/dev/null | sed 's/^git version //')"

  # 2) Node.js 22.12 or newer
  v=$(node -p 'process.versions.node' 2>/dev/null || true)
  major=${v%%.*}
  rest=${v#*.}
  minor=${rest%%.*}
  if [ -z "$v" ] || [ "$major" -lt 22 ] 2>/dev/null || { [ "$major" -eq 22 ] && [ "$minor" -lt 12 ]; } 2>/dev/null; then
    if [ -z "$v" ]; then fail "Node.js is missing: GTAgentClinic needs Node.js 22.12 or newer."; else fail "Node.js $v is too old: GTAgentClinic needs 22.12 or newer."; fi
    echo "    macOS: brew install node   (Homebrew), or the LTS installer from https://nodejs.org"
    echo "    Linux: nvm install --lts   (https://github.com/nvm-sh/nvm; distribution packages are often too old)"
    echo "    Then open a new terminal and run this again."
    return 1
  fi
  ok "Node.js $v"

  # 3) Claude Code (optional): only `claude auth status`, and only its loggedIn field is read
  if command -v claude >/dev/null 2>&1; then
    if claude auth status 2>/dev/null | grep -q '"loggedIn": *true'; then
      ok "Claude Code is installed and logged in"
    else
      note "Claude Code is installed but not logged in. Run ${b}claude${n} once and log in; the game asks later."
    fi
  else
    note "Claude Code isn't installed (optional). To run the characters on your own login: https://claude.com/claude-code"
  fi

  # 4) the game: clone, or update an existing checkout
  if [ -d "$dir/.git" ]; then
    ok "Updating $dir (git pull)"
    if ! GIT_TERMINAL_PROMPT=0 git -C "$dir" pull --ff-only; then
      note "Couldn't update $dir (local changes or a diverged branch?); continuing with the version you have."
    fi
  elif [ -e "$dir" ]; then
    fail "$dir exists but isn't a git checkout of the game. Choose another folder: sh install.sh <folder>"
    return 1
  else
    ok "Cloning into $dir"
    # a private fork or mirror: the plain HTTPS clone needs credentials, so try your GitHub CLI login,
    # then your SSH key (owner/name from a github.com URL)
    slug=$(printf '%s' "$repo" | sed -n 's#^.*github\.com[:/]\([^/]*/[^/.]*\)\(\.git\)\{0,1\}/*$#\1#p')
    GIT_TERMINAL_PROMPT=0 git clone "$repo" "$dir" 2>/dev/null ||
      { [ -n "$slug" ] && command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1 && gh repo clone "$slug" "$dir"; } ||
      { [ -n "$slug" ] && git clone "git@github.com:$slug.git" "$dir"; } || {
        fail "git clone failed (see above). Check your connection. For a private fork, log in with the GitHub CLI (gh auth login) or add an SSH key to GitHub."
        return 1
      }
  fi
  cd "$dir" || return 1

  # 5) dependencies (about 200 MB; neural voices are a separate, optional npm run voices:install)
  ok "npm install"
  npm install --no-fund --no-audit || {
    fail "npm install failed (see above). Check your internet connection, then run this again. Help: docs/SETUP.md#troubleshooting"
    return 1
  }

  if [ "$start" = 0 ]; then
    ok "Installed in $(pwd). Start it with: cd $dir && npm start"
    return 0
  fi
  printf '\n  %sStarting the game: npm start (Ctrl+C stops it; later: cd %s && npm start)%s\n' "$d" "$dir" "$n"
  # piped from curl, our stdin is the script: give npm start the terminal, so the first-run question can be answered
  if [ -t 0 ]; then
    npm start
  elif (: </dev/tty) 2>/dev/null; then
    npm start </dev/tty
  else
    npm start
  fi
}

main "$@"
