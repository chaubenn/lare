# Lare privacy policy

Effective 2 November 2026.

Lare is a desktop app and a Chrome extension ("Lare for LeetCode") for tracking LeetCode
practice, recording mock interviews and sharing solutions. This policy covers both. It says what
Lare collects, why, where it goes and how to have it removed. The engineering detail behind it is
in [privacy.md](privacy.md).

## What Lare collects

**Your account.** When you sign in with GitHub or Google, Lare receives your name, email address
and profile picture from that provider, and keeps a session token so you stay signed in. Lare
never sees your GitHub or Google password.

**Your LeetCode practice.** While the extension is installed and you are signed in, it records the
LeetCode problems you open (title, difficulty, topics and description) and every solution you
submit for judging: the code, the language, the verdict, runtime and memory, and how those compare
with other submissions. It only reads pages on `leetcode.com`. This is private to your account
until you choose to publish a post.

**Your mock interviews.** Nothing is recorded until you start a mock interview or a recording
yourself. During one, the desktop app records your screen and microphone, and your camera if you
turn it on, and the extension records the interview timer and the edits you make in the code
editor. A red dot stays on the LeetCode page, and the desktop app shows its recording pill, for
as long as the recording runs.

**Transcripts and AI reviews.** Speech is transcribed on your own computer; audio is never sent
anywhere for transcription. The text transcript is stored with the interview. If you ask for an AI
review, the transcript, your code and your submissions are sent to OpenAI to grade the interview.
No video or audio is sent to OpenAI.

**What you publish.** Posts, profile details (name, handle, bio, website, photo), follows and
comments are stored so that the people you share them with can see them.

## What Lare does not do

- It does not sell your data, show ads, or share your data with anyone for advertising.
- It does not track you across other websites. The extension only runs on `leetcode.com` and talks
  to Lare's own servers and to the Lare desktop app on your computer (`127.0.0.1`).
- It does not record anything in the background. Practice tracking captures problems and
  submissions only; screen, camera and microphone are recorded only during a recording you started.
- It does not run code downloaded from the internet. Everything the extension runs ships inside
  it.

## Where your data is stored

| Service | What it holds |
| --- | --- |
| Supabase | Your account, practice history, interviews, transcripts, reviews, posts and thumbnails |
| Bunny.net (Bunny Stream) | Recorded videos |
| OpenAI | Interview transcripts, code and submissions, only while an AI review is being written |
| GitHub / Google | Sign-in only |

Videos are uploaded while they record. A copy stays on your computer until the uploaded video has
finished processing, then it is deleted. A video is only playable by people allowed to see the post
it belongs to, but someone who was allowed to watch it can keep a direct link to it; deleting the
video is what removes it for good.

## Who can see it

Your practice history, interviews and drafts are visible only to you. A post is visible to the
people you choose: everyone, or only you. A private account limits public posts to followers you
accept. AI grades and transcripts are shown with a post only if you turn on **Include AI insights
with the post** for that post.

## Keeping and deleting your data

Your data is kept while you have a Lare account.

- Deleting a video or a post in the app removes the video from Bunny.net and its records.
- Removing tracked problems in the extension's side panel deletes them and their submissions.
- Uninstalling the extension stops all practice capture straight away.
- To delete your account and everything in it, email the address below from the email address on
  your account. It is removed within 30 days.

## Children

Lare is not meant for children under 13 and does not knowingly collect their data.

## Changes

If this policy changes, the new version is published here with a new effective date.

## Contact

Questions, or a request to see or delete your data: **benjaminchau05@gmail.com**.
