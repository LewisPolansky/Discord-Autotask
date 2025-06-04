<div align="center">
  <img src="/Autotask_wordmark.png" alt="Autotask Logo" style="height: 250px; border-radius: 20px; box-shadow: 0 0 10px 0 rgba(0, 0, 0, 0.1);">
</div>

# Autotask: Dump plaintext tasks into Linear
An AI Linear Bot for Discord

## Overview
This bot:
1. Takes a list of tasks from a Discord command /createtasks.
2. Sends it to Gemini for parsing & upgrading.
3. Asks you to check its work before uploading.
3. Creates tasks directly in your Linear project automatically.
4. Returns clickable task links to Discord.
5. Includes an undo button.

## To Deploy on Docker or Proxmox:

First, you'll need to set up your environment variables:
1. Clone the repository.
2. Make a copy of the `.env.example` file and rename it to `.env`.
3. Open the `.env` file and fill in your credentials for each variable (e.g., `DISCORD_TOKEN`, `GEMINI_API_KEY`, etc.). **Do not commit the `.env` file to version control.**

Once your `.env` file is configured:

1. **Docker Setup**

Install Docker, then run:

```bash
docker build -t discord-autotask .
docker run -d --env-file .env discord-autotask
```

2. **Proxmox**

- Spin up an LXC or VM with Node.js and Docker.
- After cloning the repo and setting up your `.env` file as described above, you can run the bot with Docker (see Docker Setup) or directly using `node index.js`.

---

## Undo Functionality

Undo works by caching the created issue IDs and deleting them on request. Only the last task batch can be undone.

## Sample Prompts File (`sample_prompts.txt`)

This file (`sample_prompts.txt`) contains an example of a multi-sprint plan for an imaginary software engineering company. It's provided as a reference to illustrate the kind of plaintext natural language input and task structure that can be processed by Autotask. 