# EGS Quizit!

Source mirror for the EGS Quizit! inter-school quiz arena, currently hosted on Hatchable and backed by Supabase.

## Source layout

- `public/index.html` — live scoreboard and application shell
- `public/app.js` — quiz UI, round controls, score/pounce actions and Supabase client
- `public/theme.css` — themes and presentation layout
- `public/login.html`, `pages/admin-access.js` — admin access screens
- `public/guide.html` — operator guide
- `public/questions-template.csv` — CSV import template
- `public/assets/` — EGS Quizit! and school logos
- `hatchable.toml` — Hatchable project configuration

## Quiz rules

The six rounds are **Science**, **Sports**, **General Knowledge**, **History**, **Current Affairs**, and **Music**. The application uses one 10-second timer, +10 for a correct team answer, 0 for a wrong answer in Rounds 1–5 and −5 in the final round, and +10/−5 pounce scoring during the timer in Rounds 1–5. Pounces are disabled for the question-owning team, audience questions, and the final round.

Rounds 1, 2, 4, and 5 allow one question per team; Round 3 and the final round allow two. Rounds 1–5 support up to two audience questions per round. The final Music round is arranged as eight paired audio slips, with A/B questions sharing each slip.

## Current question bank

The old multiple-choice bank has been replaced. The live Supabase bank contains **554 open-ended questions and 554 answer keys**:

| Round | Questions |
| --- | ---: |
| Science | 120 |
| Sports | 120 |
| General Knowledge | 120 |
| History | 120 |
| Current Affairs (October 2026) | 58 |
| Music (8 paired audio slips) | 16 |
| **Total** | **554** |

The bank was verified after activation: all 554 rows are available, answer keys are present, no obvious A/B/C/D option blocks remain, and each final-round pair shares its set tag. Previous score, draw, pounce, and audit history was cleared at the owner's request.

### Sources and attribution

- Source questions for Science, Sports, General Knowledge, and History are adapted from [OpenTriviaQA](https://github.com/uberspot/OpenTriviaQA), under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
- Current-affairs questions carry source links in the database to official Press Information Bureau releases, Reuters reports, and NobelPrize.org.
- The final round uses audio recordings linked from Wikimedia Commons. Consult each source file page for recording attribution and licence details.

## Hosting and database

The production app is hosted at https://egs-quizit-0qep.hatchable.site. This repository mirrors the current app source and original logo assets; it is not configured as a GitHub Pages deployment. The application uses the connected Supabase project for question text, answer keys, settings, scores, draws, teams, and pounce records.

For a fresh environment, configure the Supabase project URL and public/anon key in the client and provision the matching database schema, RLS policies, and database functions. Do not commit Supabase service-role keys or other private credentials to this repository.
