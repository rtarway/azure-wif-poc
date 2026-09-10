// Lightweight, robust YAML parser with js-yaml fallback
const fs = require('fs');

function parseYamlOrJson(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');

  // Try loading js-yaml if installed
  try {
    const yaml = require('js-yaml');
    return yaml.load(content);
  } catch {
    // Built-in parser fallback for standard tool registry definitions
    return parseSimpleYaml(content);
  }
}

function parseSimpleYaml(content) {
  // Check if it is JSON
  if (content.trim().startsWith('{')) {
    return JSON.parse(content);
  }

  const lines = content.split('\n');
  const result = { tools: [] };
  let currentTool = null;
  let currentArrayField = null;
  let currentObjectField = null;
  let inProperties = false;
  let currentProperty = null;

  for (let rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const indent = line.search(/\S/);

    if (trimmed.startsWith('version:')) {
      result.version = trimmed.split(':')[1].trim().replace(/['"]/g, '');
    } else if (trimmed.startsWith('- name:')) {
      currentTool = {
        name: trimmed.split(':')[1].trim().replace(/['"]/g, ''),
        allowed_containers: [],
        allowed_actions: [],
        inputSchema: { type: 'object', properties: {}, required: [] }
      };
      result.tools.push(currentTool);
      currentArrayField = null;
      currentObjectField = null;
      inProperties = false;
      currentProperty = null;
    } else if (currentTool) {
      if (trimmed.startsWith('title:')) {
        currentTool.title = trimmed.substring(6).trim().replace(/^['"]|['"]$/g, '');
      } else if (trimmed.startsWith('description:')) {
        currentTool.description = trimmed.substring(12).trim().replace(/^['"]|['"]$/g, '');
      } else if (trimmed.startsWith('required_scope:')) {
        currentTool.required_scope = trimmed.substring(15).trim().replace(/['"]/g, '');
      } else if (trimmed.startsWith('target_backend:')) {
        currentTool.target_backend = trimmed.substring(15).trim().replace(/['"]/g, '');
      } else if (trimmed.startsWith('allowed_containers:')) {
        currentArrayField = 'allowed_containers';
        inProperties = false;
      } else if (trimmed.startsWith('allowed_actions:')) {
        currentArrayField = 'allowed_actions';
        inProperties = false;
      } else if (trimmed.startsWith('inputSchema:')) {
        currentArrayField = null;
        inProperties = false;
      } else if (trimmed.startsWith('properties:')) {
        inProperties = true;
        currentArrayField = null;
      } else if (trimmed.startsWith('required:')) {
        currentArrayField = 'required';
        inProperties = false;
      } else if (trimmed.startsWith('- ') && currentArrayField) {
        const val = trimmed.substring(2).trim().replace(/['"]/g, '');
        if (currentArrayField === 'required') {
          currentTool.inputSchema.required.push(val);
        } else {
          currentTool[currentArrayField].push(val);
        }
      } else if (inProperties) {
        if (indent === 8 && trimmed.endsWith(':')) {
          currentProperty = trimmed.slice(0, -1).trim();
          currentTool.inputSchema.properties[currentProperty] = {};
        } else if (currentProperty && indent >= 10) {
          const colonIdx = trimmed.indexOf(':');
          if (colonIdx > 0) {
            const key = trimmed.slice(0, colonIdx).trim();
            const val = trimmed.slice(colonIdx + 1).trim().replace(/['"]/g, '');
            if (val.startsWith('[') && val.endsWith(']')) {
              currentTool.inputSchema.properties[currentProperty][key] = val
                .slice(1, -1)
                .split(',')
                .map(s => s.trim().replace(/['"]/g, ''));
            } else {
              currentTool.inputSchema.properties[currentProperty][key] = val;
            }
          }
        }
      }
    }
  }

  return result;
}

module.exports = {
  parseYamlOrJson,
  parseSimpleYaml
};
