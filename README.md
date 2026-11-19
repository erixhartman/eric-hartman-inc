# Eric Hartman Inc. — FY2027 roadmap

**Objective:** improve long-term health and performance at Eric Hartman Inc.

- **KR1:** run the Toronto Half Marathon (May 2, 2027)
- **KR2:** finish the 12 books lent to me by a very well-read friend by Blue Jays Opening Day (March 25, 2027)

A public tracker for the goals from my LinkedIn post. Shows countdowns, runs against the training plan, and reading progress.

## How updating works

There's no backend. Progress lives in `public/data.json` in this repo.

- The public page reads `data.json`.
- `/#edit` is the owner view. It asks for a GitHub fine-grained token with write access to this one repo, then saves each update as a commit to `data.json`. Vercel redeploys, and the public page shows it within about a minute.
- Anyone without that token can read but can't change anything. The commit history doubles as an audit log.

## Training plan (from Appendix 1)

| When | Plan |
|---|---|
| December | Build up to 30 minutes on the treadmill |
| January–March | At least 6 km, at least 5 times a week |
| April–race day | Keep 5 runs a week, including at least five 10 km runs |

Book page counts are estimates and can be corrected in the owner view.

Built with React and Vite. Styled after my [portfolio](https://eric-hartman-portfolio.vercel.app/).
