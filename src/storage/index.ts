// Task output file storage
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT_DIR = path.join(__dirname, '../../output');

// Type definitions
export interface FileInfo {
  name: string;
  path: string;
  size: number;
  created?: Date;
}

export interface CoderFile {
  path?: string;
  name?: string;
  content?: string;
}

export interface CoderOutput {
  files?: CoderFile[];
}

// Ensure output directory exists
async function ensureOutputDir(taskId: number | string): Promise<string> {
  const taskDir = path.join(OUTPUT_DIR, `task_${taskId}`);
  await fs.mkdir(taskDir, { recursive: true });
  return taskDir;
}

// Save a file for a task
export async function saveTaskFile(taskId: number | string, filename: string, content: string): Promise<string> {
  const taskDir = await ensureOutputDir(taskId);
  const filepath = path.join(taskDir, filename);
  await fs.writeFile(filepath, content, 'utf-8');
  console.log(`Saved file: ${filepath}`);
  return filepath;
}

// Save multiple files from coder output
export async function saveCoderOutput(taskId: number | string, output: string | CoderOutput): Promise<FileInfo[]> {
  const savedFiles: FileInfo[] = [];

  try {
    const parsed: CoderOutput = typeof output === 'string' ? JSON.parse(output) : output;

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
  } catch {
    // If not valid JSON or no files, save raw output
    const outputStr = typeof output === 'string' ? output : JSON.stringify(output);
    if (outputStr && outputStr.length > 0) {
      const filepath = await saveTaskFile(taskId, 'output.txt', outputStr);
      savedFiles.push({
        name: 'output.txt',
        path: filepath,
        size: outputStr.length
      });
    }
  }

  return savedFiles;
}

// Get all files for a task
export async function getTaskFiles(taskId: number | string): Promise<FileInfo[]> {
  const taskDir = path.join(OUTPUT_DIR, `task_${taskId}`);

  try {
    const files = await fs.readdir(taskDir);
    const fileInfos = await Promise.all(
      files.map(async (filename): Promise<FileInfo> => {
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
  } catch {
    return [];
  }
}

// Get file content
export async function getTaskFile(taskId: number | string, filename: string): Promise<string> {
  const filepath = path.join(OUTPUT_DIR, `task_${taskId}`, filename);
  return await fs.readFile(filepath, 'utf-8');
}
