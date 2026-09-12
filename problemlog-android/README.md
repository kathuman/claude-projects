# Problem Log — Android

Talk through a problem (or type it), and get back a structured record —
title, summary, category, a short-term mitigation, and a long-term
solution — saved to a database on your phone.

Built with [Flutter](https://flutter.dev). On-device speech-to-text captures
what you say; [Claude](https://www.anthropic.com/claude) turns the raw
description into the structured fields; everything is stored locally in
SQLite. There is no backend and no account — the only network call the app
makes is straight from your phone to `api.anthropic.com`, using your own key.

## How it works

1. **New problem** → describe it, by talking (tap the mic) or typing.
2. **Analyze** → the description is sent to Claude, which is asked (via a
   forced tool-call, not free-text parsing) to return exactly:
   `title`, `summary`, `category`, `long_term_solution`, `short_term_mitigation`.
3. **Review** → every generated field is editable before you save anything.
4. **Save** → a record is written to the local database:

   | field | source |
   |---|---|
   | `problemID` | generated (UUID) |
   | `title` | Claude, editable |
   | `description` | your raw description, verbatim |
   | `summarizedDescription` (`summary`) | Claude, editable |
   | `category` | Claude, editable |
   | `longTermSolution` | Claude, editable |
   | `shortTermMitigation` | Claude, editable |
   | `date` | captured at save time |

The home screen lists every saved problem (search box once you have more
than a few), tap one to see the full record or delete it.

## Setup — you need your own Claude API key

This app doesn't ship with an API key (and never will — one baked into an
APK is trivially extractable). Get one from
[console.anthropic.com → API Keys](https://console.anthropic.com/settings/keys),
then open the app's **Settings** (gear icon, top-right) and paste it in. It's
stored via `flutter_secure_storage`, backed by the Android Keystore, and
never leaves the device except in the direct HTTPS call to Anthropic.

Each "Analyze" tap is one Claude API call — check the Anthropic console for
usage/cost.

## Project layout

```
lib/
  data/
    problem.dart            — Problem + ProblemAnalysis models
    problem_database.dart   — sqflite CRUD (single "problems" table)
  services/
    claude_service.dart     — calls the Messages API with a forced tool
                               schema; parseAnalysisResponse() is pure and
                               unit-tested without any network access
    speech_service.dart     — wraps speech_to_text (on-device dictation)
    settings_service.dart   — API key storage (flutter_secure_storage)
  ui/
    home_screen.dart         — list + search + FAB
    new_problem_screen.dart  — describe -> analyze -> review -> save
    problem_detail_screen.dart
    settings_screen.dart
test/
  problem_model_test.dart   — Problem round-trip, ClaudeService response
                               parsing (well-formed / malformed / whitespace)
  widget_test.dart           — app boot, navigation to the describe screen
```

## Building

Requires the [Flutter SDK](https://docs.flutter.dev/get-started/install) and
an Android SDK (`flutter doctor` checks this). From this directory:

```bash
flutter pub get
flutter build apk --release --split-per-abi
```

`--split-per-abi` produces a much smaller per-architecture APK — use
`app-arm64-v8a-release.apk` for essentially any phone from the last several
years. Install straight to a connected/debuggable device with:

```bash
flutter install --release
```

or sideload the APK file directly (enable "install unknown apps" for
whatever app you transfer it through).

It's signed with the Flutter debug keystore, which is fine for sideloading
but not for a Play Store listing.

## Testing

```bash
flutter analyze
flutter test
```

## Privacy note

Your problem descriptions are sent to Anthropic's API to generate the
structured fields — the same as they would be for any Claude API call you
made yourself. Nothing is sent anywhere else; there is no analytics, no
telemetry, and no server operated by this app.
