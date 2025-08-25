# AI scrummaster

Voice Scrum Master — a voice-to-action AI standup facilitator
  --------------------------------------------------------------
  
 What it does (no external services required):
 - Speaks standup prompts (yesterday/today/blockers) to each teammate
 - Listens to voice answers via Web Speech API (or lets you type)
 - Responds with acknowledgements via text-to-speech
 - Auto-parses answers into Actions (tasks), Blockers, and Notes
 - Times each speaker, saves a transcript, and generates a summary
 - Optional: post summary to Slack via Incoming Webhook (paste URL below)
 - NEW: Autoplays a video on page load; on video end, auto-scrolls to the Team section

* Quick start:
* 1) Add teammates, check your mic, then press "Start standup".
* 2) The bot will guide each person with three questions.
* 3) Say "done" to move to the next question/member.
* 4) Review actions/blockers, then export JSON or post to Slack.
*
* Tips:
* - Works best in Chrome/Edge on desktop over HTTPS (mic permissions).
* - If speech recognition is unavailable, toggle "Manual input".
* - Configure a Slack Incoming Webhook if you want to post the summary.


Preview as below  
 --------------------------------------------------------------
 
<img width="1964" height="1374" alt="image" src="https://github.com/user-attachments/assets/d3aa4b32-4840-4642-8b23-d9211f91566b" />

```
