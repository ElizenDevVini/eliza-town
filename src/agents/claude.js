import Anthropic from '@anthropic-ai/sdk';
import { getSystemPrompt } from './config.js';
import { logApiCall } from '../db/index.js';

const anthropic = new Anthropic();

const MODEL = 'claude-sonnet-4-20250514';

export async function callClaude(agentId, agentType, taskId, prompt, context = {}) {
  const systemPrompt = getSystemPrompt(agentType);
  const startTime = Date.now();

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
