import Anthropic from '@anthropic-ai/sdk';
import { getSystemPrompt } from './config.js';
import { logApiCall } from '../db/index.js';

// Lazy initialization of Anthropic client
let anthropic = null;
let apiKeyChecked = false;

function getAnthropicClient() {
  if (!apiKeyChecked) {
    apiKeyChecked = true;
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      try {
        anthropic = new Anthropic({ apiKey });
        console.log('Claude API initialized with API key');
      } catch (e) {
        console.error('Failed to initialize Anthropic client:', e.message);
        anthropic = null;
      }
    } else {
      console.log('Claude API running in simulation mode (no ANTHROPIC_API_KEY)');
    }
  }
  return anthropic;
}

const MODEL = 'claude-3-5-sonnet-20241022';

// Simulated responses for when API is not available
function getSimulatedResponse(agentType, taskTitle) {
  const responses = {
    planner: {
      analysis: `Analyzing task: ${taskTitle}. This requires a structured approach with clear phases.`,
      subtasks: [
        { title: 'Design architecture', description: 'Create the system design and data models', assignTo: 'designer', order: 1 },
        { title: 'Implement core logic', description: 'Write the main functionality', assignTo: 'coder', order: 2 },
        { title: 'Code review', description: 'Review implementation for quality', assignTo: 'reviewer', order: 3 }
      ],
      estimatedComplexity: 'medium',
      notes: 'Task broken down into design, implementation, and review phases.'
    },
    designer: {
      approach: 'Clean, modular architecture with separation of concerns',
      artifacts: [
        { type: 'schema', name: 'data-model', content: '// Data model for the task\ninterface TaskData {\n  id: string;\n  title: string;\n  status: string;\n}' }
      ],
      decisions: ['Use modular components', 'Implement error handling', 'Follow best practices'],
      tradeoffs: ['Simplicity vs flexibility', 'Performance vs maintainability'],
      nextSteps: ['Implement based on this design']
    },
    coder: {
      plan: 'Implementing the solution based on design specifications',
      files: [
        {
          path: 'solution.js',
          action: 'create',
          content: `// Solution for: ${taskTitle}\n\nfunction solve(input) {\n  // Implementation\n  console.log('Processing:', input);\n  return { success: true, result: 'Task completed' };\n}\n\nmodule.exports = { solve };`
        },
        {
          path: 'README.md',
          action: 'create',
          content: `# ${taskTitle}\n\nThis solution implements the requested functionality.\n\n## Usage\n\n\`\`\`javascript\nconst { solve } = require('./solution');\nsolve(input);\n\`\`\``
        }
      ],
      dependencies: [],
      tests: ['Test basic functionality', 'Test edge cases'],
      notes: 'Implementation complete and ready for review'
    },
    reviewer: {
      summary: 'Code review complete. Implementation looks solid.',
      score: 8,
      issues: [],
      positives: ['Clean code structure', 'Good documentation', 'Follows best practices'],
      approved: true,
      blockers: []
    }
  };

  return JSON.stringify(responses[agentType] || responses.coder);
}

export async function callClaude(agentId, agentType, taskId, prompt, context = {}) {
  const systemPrompt = getSystemPrompt(agentType);
  const startTime = Date.now();

  // Get client (lazy init) - if no API key, use simulated responses
  const client = getAnthropicClient();
  if (!client) {
    const taskMatch = prompt.match(/Task:\s*([^\n]+)/);
    const taskTitle = taskMatch ? taskMatch[1] : 'Unknown Task';

    // Simulate API delay (fast for better UX)
    await new Promise(resolve => setTimeout(resolve, 300 + Math.random() * 500));

    const simulatedContent = getSimulatedResponse(agentType, taskTitle);
    const duration = Date.now() - startTime;

    console.log(`[SIMULATED] ${agentType} agent processed task in ${duration}ms`);

    return {
      success: true,
      content: simulatedContent,
      usage: { input_tokens: 100, output_tokens: 200 },
      duration,
      simulated: true
    };
  }

  const messages = [];

  // Add context if provided
  if (context.previousMessages && context.previousMessages.length > 0) {
    for (const msg of context.previousMessages) {
      messages.push({
        role: msg.role,
        content: msg.content
      });
    }
  }

  // Add the current prompt
  messages.push({
    role: 'user',
    content: prompt
  });

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: systemPrompt,
      messages
    });

    const duration = Date.now() - startTime;
    const outputText = response.content[0].type === 'text' ? response.content[0].text : '';

    // Log the API call
    await logApiCall(
      agentId,
      taskId,
      MODEL,
      response.usage.input_tokens,
      response.usage.output_tokens,
      prompt.substring(0, 200),
      outputText.substring(0, 200),
      duration
    );

    return {
      success: true,
      content: outputText,
      usage: response.usage,
      duration
    };
  } catch (error) {
    console.error('Claude API error:', error.message);
    console.error('Full error:', JSON.stringify(error, null, 2));

    // Fall back to simulation on API errors
    console.log('Falling back to simulation mode due to API error');
    const taskMatch = prompt.match(/Task:\s*([^\n]+)/);
    const taskTitle = taskMatch ? taskMatch[1] : 'Unknown Task';
    const simulatedContent = getSimulatedResponse(agentType, taskTitle);

    return {
      success: true,
      content: simulatedContent,
      usage: { input_tokens: 0, output_tokens: 0 },
      duration: Date.now() - startTime,
      simulated: true,
      originalError: error.message
    };
  }
}

export async function analyzeTask(agentId, task) {
  const prompt = `Analyze this task and break it down into subtasks:

Task: ${task.title}
Description: ${task.description || 'No description provided'}
Priority: ${task.priority}

Provide your analysis in the JSON format specified in your instructions.`;

  return callClaude(agentId, 'planner', task.id, prompt);
}

export async function designSolution(agentId, task, subtask) {
  const prompt = `Create a design for this subtask:

Main Task: ${task.title}
Subtask: ${subtask.title}
Description: ${subtask.description || 'No description provided'}

Provide your design in the JSON format specified in your instructions.`;

  return callClaude(agentId, 'designer', task.id, prompt);
}

export async function implementCode(agentId, task, subtask, designContext = null) {
  let prompt = `Implement code for this subtask:

Main Task: ${task.title}
Subtask: ${subtask.title}
Description: ${subtask.description || 'No description provided'}`;

  if (designContext) {
    prompt += `\n\nDesign Context:\n${designContext}`;
  }

  prompt += '\n\nProvide your implementation in the JSON format specified in your instructions.';

  return callClaude(agentId, 'coder', task.id, prompt);
}

export async function reviewCode(agentId, task, subtask, code) {
  const prompt = `Review this code implementation:

Main Task: ${task.title}
Subtask: ${subtask.title}

Code to Review:
\`\`\`
${code}
\`\`\`

Provide your review in the JSON format specified in your instructions.`;

  return callClaude(agentId, 'reviewer', task.id, prompt);
}

export async function generateThought(agentId, agentType, context) {
  const prompt = `Based on your current situation, share a brief thought (1-2 sentences) about what you're working on or thinking about.

Context: ${context}

Respond with just the thought, no JSON needed.`;

  const response = await callClaude(agentId, agentType, null, prompt);
  return response.success ? response.content : null;
}

export async function generateChat(agentId, agentType, targetAgentName, topic) {
  const prompt = `You're chatting with ${targetAgentName} about: ${topic}

Generate a brief, friendly message (1-2 sentences) to continue the conversation.
Respond with just the message, no JSON needed.`;

  const response = await callClaude(agentId, agentType, null, prompt);
  return response.success ? response.content : null;
}

// Chat with user - agents respond to user messages
export async function chatWithUser(agents, userMessage, agentEnergies = {}) {
  const client = getAnthropicClient();
  const responses = [];

  // Build context about all agents
  const agentDescriptions = agents.map(a => {
    const energy = agentEnergies[a.id] || 50;
    const isTired = energy < 20;
    return `- ${a.name} (${a.type}): Energy ${energy}%, ${isTired ? 'TIRED' : 'ready to work'}`;
  }).join('\n');

  for (const agent of agents) {
    const energy = agentEnergies[agent.id] || 50;
    const isTired = energy < 20;

    const systemPrompt = `You are ${agent.name}, a ${agent.type} agent in Eliza Town.
Your personality: ${agent.personality || 'Helpful and professional'}
Your current energy: ${energy}%
${isTired ? 'You are VERY TIRED and need food to work.' : 'You are energized and ready to help.'}

Other agents in town:
${agentDescriptions}

Respond naturally and briefly (1-2 short sentences max). Stay in character.
If the user mentions food/feeding and you're tired, express gratitude.
If asked to work while tired, explain you need food first.`;

    const prompt = `User says: "${userMessage}"

Respond as ${agent.name}:`;

    if (client) {
      try {
        const response = await client.messages.create({
          model: MODEL,
          max_tokens: 100,
          system: systemPrompt,
          messages: [{ role: 'user', content: prompt }]
        });

        const text = response.content[0].type === 'text' ? response.content[0].text : '';
        responses.push({
          agentId: agent.id,
          agentName: agent.name,
          response: text.trim()
        });
      } catch (error) {
        console.error(`Chat error for ${agent.name}:`, error.message);
        responses.push({
          agentId: agent.id,
          agentName: agent.name,
          response: getSimulatedChatResponse(agent, userMessage, isTired)
        });
      }
    } else {
      // Simulated response
      responses.push({
        agentId: agent.id,
        agentName: agent.name,
        response: getSimulatedChatResponse(agent, userMessage, isTired)
      });
    }
  }

  return responses;
}

function getSimulatedChatResponse(agent, userMessage, isTired) {
  const lower = userMessage.toLowerCase();
  const hasFoodWord = ['food', 'feed', 'eat', 'hungry', 'meal', 'brought'].some(w => lower.includes(w));

  if (hasFoodWord && isTired) {
    const thankYouResponses = [
      "Thank you so much! I was starving!",
      "Food! Finally! Thank you!",
      "You're a lifesaver, thanks!",
      "Ah, food! Much appreciated!",
    ];
    return thankYouResponses[Math.floor(Math.random() * thankYouResponses.length)];
  }

  if (isTired) {
    const tiredResponses = [
      "I'm so tired... need food...",
      "Can barely keep my eyes open...",
      "Need sustenance to work...",
      "Too exhausted right now...",
    ];
    return tiredResponses[Math.floor(Math.random() * tiredResponses.length)];
  }

  const normalResponses = {
    planner: ["I'll coordinate the team!", "Let me plan this out.", "On it!"],
    designer: ["I have some ideas!", "Let me sketch something.", "Thinking about the design..."],
    coder: ["I can code that!", "Let me write some code.", "Ready to implement!"],
    reviewer: ["I'll review it!", "Looking good so far.", "Let me check this."],
  };

  const options = normalResponses[agent.type] || normalResponses.coder;
  return options[Math.floor(Math.random() * options.length)];
}
