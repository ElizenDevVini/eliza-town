import Anthropic from '@anthropic-ai/sdk';
import { getSystemPrompt } from './config.js';
import { logApiCall } from '../db/index.js';

// Check if API key is available
const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
let anthropic = null;

if (hasApiKey) {
  anthropic = new Anthropic();
  console.log('Claude API initialized with API key');
} else {
  console.log('Claude API running in simulation mode (no ANTHROPIC_API_KEY)');
}

const MODEL = 'claude-sonnet-4-20250514';

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

  // If no API key, use simulated responses
  if (!anthropic) {
    const taskMatch = prompt.match(/Task:\s*([^\n]+)/);
    const taskTitle = taskMatch ? taskMatch[1] : 'Unknown Task';

    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));

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
    const response = await anthropic.messages.create({
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
    console.error('Claude API error:', error);
    return {
      success: false,
      error: error.message,
      duration: Date.now() - startTime
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
