import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { emptyProject } from '../../../utils/film/projectShape';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '20mb',
    },
  },
};

const PROJECT_FILENAME = 'project.json';
const RECENT_FILENAME = 'film-agent-recent.json';
const recentStorePath = () => path.join(os.homedir(), '.modelark-starter-kit', RECENT_FILENAME);

const ensureParentDir = (filePath) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
};

const readJsonSafe = (filePath, fallback) => {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const text = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(text);
  } catch {
    return fallback;
  }
};

const writeJson = (filePath, value) => {
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
};

const readRecent = () => {
  const list = readJsonSafe(recentStorePath(), []);
  if (!Array.isArray(list)) return [];
  return list.filter((entry) => entry && entry.path);
};

const writeRecent = (list) => {
  writeJson(recentStorePath(), list.slice(0, 12));
};

const updateRecent = (entry) => {
  const existing = readRecent().filter((item) => item.path !== entry.path);
  const next = [{ ...entry, lastOpened: new Date().toISOString() }, ...existing];
  writeRecent(next);
  return next;
};

const isAbsolutePath = (p) => typeof p === 'string' && p.length > 0 && path.isAbsolute(p);

export default async function projectHandler(req, res) {
  const { action } = req.query;

  try {
    if (req.method === 'GET' && action === 'recent') {
      return res.status(200).json({ recent: readRecent() });
    }

    if (req.method === 'POST' && action === 'init') {
      const { projectPath, title, language, targetMinutes } = req.body || {};
      if (!isAbsolutePath(projectPath)) {
        return res.status(400).json({ error: 'projectPath must be an absolute path' });
      }
      fs.mkdirSync(projectPath, { recursive: true });
      fs.mkdirSync(path.join(projectPath, 'assets'), { recursive: true });
      const filePath = path.join(projectPath, PROJECT_FILENAME);
      if (fs.existsSync(filePath)) {
        return res.status(409).json({ error: 'A project already exists at this path. Use load instead.' });
      }
      const id = crypto.randomBytes(8).toString('hex');
      const project = emptyProject({ id, title, language, targetMinutes });
      writeJson(filePath, project);
      updateRecent({ path: projectPath, id, title: project.title });
      return res.status(200).json({ project, projectPath });
    }

    if (req.method === 'POST' && action === 'load') {
      const { projectPath } = req.body || {};
      if (!isAbsolutePath(projectPath)) {
        return res.status(400).json({ error: 'projectPath must be an absolute path' });
      }
      const filePath = path.join(projectPath, PROJECT_FILENAME);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'No project.json found at this path' });
      }
      const loaded = readJsonSafe(filePath, null);
      if (!loaded) {
        return res.status(500).json({ error: 'project.json is corrupt' });
      }
      const project = loaded;
      updateRecent({ path: projectPath, id: project.id, title: project.title });
      return res.status(200).json({ project, projectPath });
    }

    if (req.method === 'POST' && action === 'save') {
      const { projectPath, project } = req.body || {};
      if (!isAbsolutePath(projectPath)) {
        return res.status(400).json({ error: 'projectPath must be an absolute path' });
      }
      if (!project || typeof project !== 'object') {
        return res.status(400).json({ error: 'project body is required' });
      }
      fs.mkdirSync(projectPath, { recursive: true });
      const filePath = path.join(projectPath, PROJECT_FILENAME);
      const next = { ...project, updatedAt: new Date().toISOString() };
      writeJson(filePath, next);
      updateRecent({ path: projectPath, id: next.id, title: next.title });
      return res.status(200).json({ project: next, projectPath });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
