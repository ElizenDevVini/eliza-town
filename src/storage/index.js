// Task output file storage
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT_DIR = path.join(__dirname, '../../output');

// Ensure output directory exists
async function ensureOutputDir(taskId) {
  const taskDir = path.join(OUTPUT_DIR, `task_${taskId}`);
  await fs.mkdir(taskDir, { recursive: true });
  return taskDir;
}

// Save a file for a task
export async function saveTaskFile(taskId, filename, content) {
  const taskDir = await ensureOutputDir(taskId);
  const filepath = path.join(taskDir, filename);
  await fs.writeFile(filepath, content, 'utf-8');
  console.log(`Saved file: ${filepath}`);
  return filepath;
}

// Save multiple files from coder output
export async function saveCoderOutput(taskId, output) {
  const savedFiles = [];

  try {
    const parsed = typeof output === 'string' ? JSON.parse(output) : output;

    if (parsed.files && Array.isArray(parsed.files)) {
      for (const file of parsed.files) {
        const filename = file.path || file.name || `file_${savedFiles.length + 1}`;
        const content = file.content || '';
        const filepath = await saveTaskFile(taskId, filename, content);
        savedFiles.push({
          name: filename,
          path: filepath,
          size: content.length
        });
      }
    }
  } catch (e) {
    // If not valid JSON or no files, save raw output
    if (output && output.length > 0) {
      const filepath = await saveTaskFile(taskId, 'output.txt', output);
      savedFiles.push({
        name: 'output.txt',
        path: filepath,
        size: output.length
      });
    }
  }

  return savedFiles;
}

// Get all files for a task
export async function getTaskFiles(taskId) {
  const taskDir = path.join(OUTPUT_DIR, `task_${taskId}`);

  try {
    const files = await fs.readdir(taskDir);
    const fileInfos = await Promise.all(
      files.map(async (filename) => {
        const filepath = path.join(taskDir, filename);
        const stat = await fs.stat(filepath);
        return {
          name: filename,
          path: filepath,
          size: stat.size,
          created: stat.birthtime
        };
      })
    );
    return fileInfos;
  } catch (e) {
    return [];
  }
}

// Get file content
export async function getTaskFile(taskId, filename) {
  const filepath = path.join(OUTPUT_DIR, `task_${taskId}`, filename);
  return await fs.readFile(filepath, 'utf-8');
}

// Create a zip of all task files
export async function getTaskZip(taskId) {
  const files = await getTaskFiles(taskId);
  // For simplicity, return file list - in production use archiver
  return files;
}
