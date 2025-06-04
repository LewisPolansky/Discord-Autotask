require("dotenv").config();
const { Client, GatewayIntentBits, ButtonBuilder, ActionRowBuilder, ButtonStyle, SlashCommandBuilder, REST, Routes, StringSelectMenuBuilder } = require("discord.js");
const axios = require("axios");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

let lastCreatedIssueIds = [];

// Cache for workflow states
let workflowStatesCache = null;

// Cache for pending task approvals
let pendingTasksCache = new Map();
let taskIdCounter = 0;

// Register slash command
const commands = [
  new SlashCommandBuilder()
    .setName('createtasks')
    .setDescription('Create Linear tasks from a list')
    .addStringOption(option =>
      option.setName('tasks')
        .setDescription('List of tasks (one per line)')
        .setRequired(true)
    ),
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

client.on("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  
  try {
    console.log('Started refreshing application (/) commands.');
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error(error);
  }
});

client.on("interactionCreate", async (interaction) => {
  if (interaction.isButton()) {
    const customId = interaction.customId;

    if (customId.startsWith("create_all_tasks_")) {
      const taskId = customId.replace("create_all_tasks_", "");
      const tasksToCreate = pendingTasksCache.get(taskId);
      
      if (!tasksToCreate) {
        await interaction.reply({ content: "❌ Task data for this action has expired or is invalid. Please try creating the tasks again.", ephemeral: true });
        return;
      }
      
      await interaction.deferUpdate(); 
      
      try {
        const createdIssues = await Promise.all(tasksToCreate.map(createLinearIssue));
        lastCreatedIssueIds = createdIssues.map((issue) => issue.id);
        
        const replyText = createdIssues.map(issue => `- [${issue.title}](${issue.url})`).join("\n");
        
        const undoBtn = new ButtonBuilder()
          .setCustomId("undo_tasks")
          .setLabel(`Undo All ${createdIssues.length} Tasks`)
          .setStyle(ButtonStyle.Danger);
        const row = new ActionRowBuilder().addComponents(undoBtn);
        
        pendingTasksCache.delete(taskId); 
        
        await interaction.editReply({
          content: `✅ All ${createdIssues.length} tasks created successfully in Linear:\n${replyText}`,
          components: [row]
        });
      } catch (e) {
        console.error("Error during 'Create All Tasks':", e);
        // If some tasks were created before an error, offer to undo them.
        if (lastCreatedIssueIds && lastCreatedIssueIds.length > 0) {
            const undoBtn = new ButtonBuilder()
                .setCustomId("undo_tasks")
                .setLabel(`Undo ${lastCreatedIssueIds.length} Created Tasks`)
                .setStyle(ButtonStyle.Danger);
            const row = new ActionRowBuilder().addComponents(undoBtn);
            await interaction.editReply({ content: `❌ Failed to create all tasks. You can attempt to undo the ${lastCreatedIssueIds.length} tasks that might have been created.`, components: [row]});
        } else {
            await interaction.editReply({ content: "❌ Failed to create tasks in Linear.", components: [] });
        }
      }
      return;
    }

    if (customId.startsWith("cancel_all_tasks_")) {
      const taskId = customId.replace("cancel_all_tasks_", "");
      pendingTasksCache.delete(taskId);
      await interaction.update({ content: "❌ Task creation cancelled.", components: [] });
      return;
    }

    if (customId === "undo_tasks") {
      try {
        if (!lastCreatedIssueIds || lastCreatedIssueIds.length === 0) {
          await interaction.reply({ content: "🤔 Nothing to undo or task IDs were not recorded for the last operation.", ephemeral: true });
          return;
        }
        await interaction.deferUpdate();
        await Promise.all(lastCreatedIssueIds.map(deleteLinearIssue));
        const numDeleted = lastCreatedIssueIds.length;
        lastCreatedIssueIds = []; 
        await interaction.editReply({content: `🗑️ ${numDeleted} task(s) deleted successfully.`, components: []});
      } catch (e) {
        console.error("Error during undo:", e);
        await interaction.editReply("❌ Failed to delete tasks.");
      }
      return;
    }
  }

  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'createtasks') {
    const tasksInput = interaction.options.getString('tasks');
    const taskList = tasksInput.split("\n").map((t) => t.trim()).filter(Boolean);
    
    if (!taskList.length) {
      return interaction.reply("Please provide a valid list of tasks.");
    }

    await interaction.deferReply();

    try {
      const structuredTasks = await getStructuredTasks(taskList);
      
      const taskId = (++taskIdCounter).toString();
      pendingTasksCache.set(taskId, structuredTasks); 
      
      const { content, components } = await buildTaskPreview(structuredTasks, taskId);
      
      await interaction.editReply({ content, components });
    } catch (e) {
      console.error(e);
      await interaction.editReply("❌ Failed to process tasks.");
    }
  }
});

async function getStructuredTasks(tasks) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  
  const model = genAI.getGenerativeModel({ 
    model: "gemini-2.0-flash",
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            priority: { type: "string", enum: ["urgent", "high", "medium", "low"] },
            state: { type: "string", enum: ["Todo", "Backlog", "In Progress", "Done"] }
          },
          required: ["title", "description", "priority", "state"]
        }
      }
    }
  });

  const prompt = `Convert these tasks to a JSON array. For each task, create:
- title: Clear, actionable task title
- description: Markdown-formatted description with TWO sections:
  1. **Goal:** Brief explanation of what needs to be accomplished
  2. **Autotask Analysis:** Intelligent suggestions for tools, frameworks, or strategies relevant to this task. Include specific tool names, APIs, or approaches with brief explanations of when to use each.
- priority: Based on importance for MVP development (urgent/high/medium/low)
- state: Workflow state based on context clues in the task. Use "Todo" as default, or "Backlog" for future items, "In Progress" if task mentions ongoing work, "Done" if task is completed.

Tasks to convert:
${tasks.map((t, i) => `${i + 1}. ${t}`).join("\n")}

Example format for description:
**Goal:** Build a system that automates outbound sales outreach and follow-ups to increase lead conversion.

**Autotask Analysis:**  
Explore tools like [Clay](https://clay.com) for lead sourcing and enrichment, or [Gong](https://www.gong.io) for analyzing sales conversations. For sequence automation, consider [Apollo](https://www.apollo.io) or [Reply.io](https://reply.io). Choose based on your CRM integration needs, budget, and whether you need AI call analysis or pure outbound workflow automation.`;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const jsonText = response.text();
    return JSON.parse(jsonText);
  } catch (error) {
    console.error('Error generating structured tasks:', error);
    throw error;
  }
}

async function getWorkflowStates() {
  if (workflowStatesCache) {
    return workflowStatesCache;
  }

  const query = `
    query {
      team(id: "${process.env.LINEAR_TEAM_ID}") {
        states {
          nodes {
            id
            name
            type
          }
        }
      }
    }
  `;

  try {
    const res = await axios.post("https://api.linear.app/graphql", 
      { query }, 
      {
        headers: { 
          Authorization: process.env.LINEAR_API_KEY, 
          "Content-Type": "application/json" 
        }
      }
    );

    if (res.data.errors) {
      console.error('Error fetching workflow states:', res.data.errors);
      return null;
    }

    workflowStatesCache = res.data.data.team.states.nodes;
    return workflowStatesCache;
  } catch (error) {
    console.error('Error fetching workflow states:', error);
    return null;
  }
}

function findStateId(stateName, workflowStates) {
  if (!workflowStates) return null;
  
  // Map common state names to Linear state types
  const stateMapping = {
    "Todo": ["todo", "to do", "ready"],
    "Backlog": ["backlog", "triage"],
    "In Progress": ["in progress", "started", "doing"],
    "Done": ["done", "completed", "finished"]
  };

  const searchTerms = stateMapping[stateName] || [stateName.toLowerCase()];
  
  for (const term of searchTerms) {
    const state = workflowStates.find(s => 
      s.name.toLowerCase().includes(term)
    );
    if (state) return state.id;
  }

  // Fallback: find first state of appropriate type
  const typeMapping = {
    "Backlog": "backlog",
    "Todo": "unstarted", 
    "In Progress": "started",
    "Done": "completed"
  };

  const targetType = typeMapping[stateName];
  if (targetType) {
    const state = workflowStates.find(s => s.type === targetType);
    if (state) return state.id;
  }

  return null;
}

async function createLinearIssue(task) {
  const workflowStates = await getWorkflowStates();
  const stateId = findStateId(task.state, workflowStates);

  const mutation = `
    mutation IssueCreate($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue {
          id
          title
          url
        }
      }
    }
  `;

  const variables = {
    input: {
      teamId: process.env.LINEAR_TEAM_ID,
      title: task.title,
      description: task.description,
      priority: mapPriority(task.priority),
      ...(stateId && { stateId })
    }
  };

  console.log('Creating Linear issue with variables:', JSON.stringify(variables, null, 2));

  try {
    const res = await axios.post("https://api.linear.app/graphql", 
      { query: mutation, variables }, 
      {
        headers: { 
          Authorization: process.env.LINEAR_API_KEY, 
          "Content-Type": "application/json" 
        }
      }
    );

    if (res.data.errors) {
      console.error('Linear GraphQL errors:', res.data.errors);
      throw new Error(`Linear API errors: ${res.data.errors.map(e => e.message).join(', ')}`);
    }

    if (!res.data.data || !res.data.data.issueCreate) {
      console.error('Unexpected response:', res.data);
      throw new Error('Invalid response from Linear API');
    }

    if (!res.data.data.issueCreate.success) {
      throw new Error('Failed to create issue in Linear');
    }

    return res.data.data.issueCreate.issue;
  } catch (error) {
    console.error('Error creating Linear issue:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    throw error;
  }
}

async function deleteLinearIssue(id) {
  const mutation = `
    mutation {
      issueDelete(id: "${id}") { success }
    }
  `;

  await axios.post("https://api.linear.app/graphql", { query: mutation }, {
    headers: { Authorization: process.env.LINEAR_API_KEY, "Content-Type": "application/json" }
  });
}

function mapPriority(priority) {
  // Linear GraphQL API expects integer values for priority
  // Based on common conventions: 0=None, 1=Low, 2=Medium, 3=High, 4=Urgent
  // Let's try the reverse: 1=Urgent, 2=High, 3=Medium, 4=Low
  console.log(`Mapping priority: ${priority}`);
  
  let mapped;
  switch ((priority || "").toLowerCase()) {
    case "urgent": mapped = 1; break;
    case "high": mapped = 2; break;
    case "medium": mapped = 3; break;
    case "low": mapped = 4; break;
    default: mapped = 3; // Default to medium
  }
  
  console.log(`Mapped to: ${mapped}`);
  return mapped;
}

async function buildTaskPreview(tasks, taskId) {
  // Show preview of all tasks
  const preview = tasks.map((task, i) => {
    return `**${i + 1}. ${task.title}** (Priority: ${task.priority}, State: ${task.state})\n`;
  }).join("\n");

  const components = [];
  
  // Add buttons for task creation
  const createAllBtn = new ButtonBuilder()
    .setCustomId(`create_all_tasks_${taskId}`)
    .setLabel("✅ Create All Tasks")
    .setStyle(ButtonStyle.Success);

  const cancelAllBtn = new ButtonBuilder()
    .setCustomId(`cancel_all_tasks_${taskId}`)
    .setLabel("❌ Cancel")
    .setStyle(ButtonStyle.Danger);
  
  components.push(new ActionRowBuilder().addComponents(createAllBtn, cancelAllBtn));
  
  let content = `📋 **Preview of ${tasks.length} tasks to create:**\n\n${preview}\n**Review the tasks above. Click 'Create All Tasks' to create them in Linear or 'Cancel'.**`;
  
  return { content, components };
}

client.login(process.env.DISCORD_TOKEN);
