const fs = require('fs');
const path = require('path');

const raw = fs.readFileSync(
  'C:/Users/varun/.claude/projects/C--Projects-Chat-agent-builders-sim/d1e24d3f-f192-49c7-a728-ce1072dcd935/tool-results/toolu_01RW3SRAzDapr68LY4u6YnU9.json',
  'utf8'
);

// The file is a JSON array of content blocks
const contentBlocks = JSON.parse(raw);
const text = contentBlocks.map(b => b.text || '').join('');

// Extract JSON from the markdown code block
const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/);
if (!jsonMatch) {
  console.log('No JSON found in text of length', text.length);
  console.log('First 200 chars:', text.substring(0, 200));
  process.exit(1);
}

const blocks = JSON.parse(jsonMatch[1]);
const types = Object.keys(blocks);
console.log('Found', types.length, 'blocks:', types.join(', '));

// Create marketplace integrations for each core block
const marketplaceDir = path.join(__dirname, '..', 'apps', 'marketplace', 'integrations');

for (const [type, block] of Object.entries(blocks)) {
  const dir = path.join(marketplaceDir, type);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Build a proper IntegrationManifest
  const toolConfig = block.tools || { access: [] };
  const toolAccess = toolConfig.access || [];

  // Build tools array from access list (stub tools for core blocks)
  const tools = toolAccess.map(id => ({
    id,
    name: id.replace(/_/g, ' '),
    description: '',
    version: '1.0.0',
    executionMode: 'proxy',
    params: {},
    proxy: {
      handler: type,
      operation: id.replace(type + '_', '')
    }
  }));

  // If no tools, add a placeholder
  if (tools.length === 0) {
    tools.push({
      id: type + '_execute',
      name: type + ' execute',
      description: '',
      version: '1.0.0',
      executionMode: 'proxy',
      params: {},
      proxy: { handler: type, operation: 'execute' }
    });
  }

  // Convert subBlocks options format
  const rawSubBlocks = Array.isArray(block.subBlocks) ? block.subBlocks : [];
  const subBlocks = rawSubBlocks.map(sb => {
    const converted = { ...sb };
    // Convert options from {label, id} to {label, value}
    if (converted.options && Array.isArray(converted.options)) {
      converted.options = converted.options.map(opt => {
        if (typeof opt === 'string') return opt;
        if (opt.id !== undefined) return { label: opt.label, value: opt.id };
        return opt;
      });
    }
    // Rename defaultValue to default
    if (converted.defaultValue !== undefined) {
      converted.default = converted.defaultValue;
      delete converted.defaultValue;
    }
    return converted;
  });

  // Convert tools.config.tool from function expression to template
  let toolExpr = '';
  if (toolConfig.config && toolConfig.config.tool) {
    toolExpr = toolConfig.config.tool;
  } else if (toolAccess.length === 1) {
    toolExpr = toolAccess[0];
  }

  const manifest = {
    id: type,
    name: block.name || type,
    version: '1.0.0',
    description: block.description || '',
    icon: block.icon || '',
    block: {
      type: block.type || type,
      name: block.name || type,
      description: block.description || '',
      longDescription: block.longDescription,
      docsLink: block.docsLink,
      category: block.category || 'blocks',
      bgColor: block.bgColor || '#888',
      icon: block.icon || '',
      hideFromToolbar: block.hideFromToolbar,
      triggerAllowed: block.triggerAllowed,
      singleInstance: block.singleInstance,
      subBlocks: subBlocks,
      tools: {
        access: toolAccess,
        config: { tool: toolExpr }
      },
      inputs: block.inputs || {},
      outputs: block.outputs || {},
      triggers: block.triggers
    },
    tools
  };

  // Clean undefined values
  const cleaned = JSON.parse(JSON.stringify(manifest));

  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(cleaned, null, 2));
  console.log('Created manifest for:', type);
}
