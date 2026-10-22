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

## Quiz rules implemented in the application

Rounds are named Science, Sports, General Knowledge, History, Current Affairs and Music. The interface supports a fixed ten-second timer, one question per team in Rounds 1, 2, 4 and 5, two per team in Rounds 3 and 6, up to two audience questions in each non-final round, pounce scoring (+10/−5) during the timer, and paired audio-visual slips in the final round.

## Hosting and database

The production app is hosted at https://egs-quizit-0qep.hatchable.site. This repository mirrors the current source files; it is not configured as a GitHub Pages deployment. The application uses the connected Supabase project for its question bank, answer keys, settings, score events, draws, teams and pounce registrations. Supabase credentials and private server-side keys must not be committed here.

For a fresh environment, configure the Supabase URL and public/anon key in the client and provision the matching database schema, RLS policies and database functions before using the UI. The production database is not exported into this repository.

## Important data status

The replacement bank has been prepared and validated in a dry run, with 554 proposed open-ended questions (120 each for Science, Sports, General Knowledge and History, 58 Current Affairs items dated October 2026, and 16 Music questions arranged into eight paired audio slips). **That proposed bank has not been activated in production** because the authorized destructive operation was blocked before it ran. The live database therefore may still contain the previous choice-based bank. Do not treat the proposed replacement as live until a successful import has been verified.

The OpenTriviaQA source is licensed under CC BY-SA 4.0: https://github.com/uberspot/OpenTriviaQA. Current-affairs items use source links in the bank builder.
