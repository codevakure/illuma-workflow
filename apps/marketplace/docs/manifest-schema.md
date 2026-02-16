# Manifest Schema Reference

Every integration has a `manifest.json` file at its root. This document describes every field.

## Top-Level Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique integration ID. Must match directory name. |
| `name` | string | Yes | Display name. |
| `version` | string | Yes | Semantic version (e.g., "1.0.0"). |
| `description` | string | No | Short description. |
| `icon` | string | Yes | Icon component name (must exist in icon registry). |
| `block` | BlockManifest | Yes | Block UI definition. |
| `tools` | ToolManifest[] | Yes | Array of tool definitions. |
| `trigger` | TriggerManifest | No | Webhook trigger configuration. |

## BlockManifest

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | Yes | Block type (must match integration `id`). |
| `name` | string | Yes | Display name on canvas. |
| `description` | string | Yes | Short description shown in toolbar. |
| `longDescription` | string | No | Detailed description for docs. |
| `docsLink` | string | No | URL to external documentation. |
| `category` | "tools" \| "triggers" \| "blocks" | Yes | Where the block appears in the toolbar. |
| `bgColor` | string | Yes | CSS color for the block icon background. |
| `icon` | string | Yes | Icon component name. |
| `authMode` | "oauth" \| "api_key" \| "bot_token" \| "none" | No | Authentication method. |
| `hideFromToolbar` | boolean | No | If true, block won't appear in toolbar. |
| `subBlocks` | SubBlockSchema[] | Yes | Form fields for the config panel. |
| `tools` | object | Yes | Tool wiring configuration. |
| `tools.access` | string[] | Yes | List of tool IDs this block can use. |
| `tools.config.tool` | string | Yes | Tool ID resolver (static or `{{param}}` template). |
| `inputs` | object | Yes | Input definitions for the block. |
| `outputs` | object | Yes | Output definitions for the block. |
| `triggerAllowed` | boolean | No | Whether this block can act as a trigger. |

## SubBlockSchema

SubBlocks define the form fields in the block's config panel.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Field identifier. |
| `type` | SubBlockType | Yes | Input type (see types below). |
| `title` | string | Yes | Label displayed above the field. |
| `placeholder` | string | No | Placeholder text. |
| `required` | boolean \| condition | No | Whether the field is required. |
| `default` | any | No | Default value. |
| `password` | boolean | No | Mask the input. |
| `condition` | SubBlockCondition | No | Show/hide based on another field's value. |
| `dependsOn` | string[] | No | Clear this field when dependencies change. |
| `mode` | "basic" \| "advanced" \| "both" \| "trigger" | No | Which mode the field appears in. |
| `options` | array | No | For dropdowns: `[{ value, label }]`. |
| `min`, `max`, `step` | number | No | For sliders. |
| `language` | string | No | For code blocks (e.g., "json"). |

### SubBlock Types

`dropdown`, `short-input`, `long-input`, `code`, `slider`, `switch`, `file-selector`, `file-upload`, `checkbox-list`, `radio-group`, `table`, `tool-input`, `oauth-account`, `credential-selector`

### Conditions

Conditions control when a subBlock is visible:

```json
{ "field": "operation", "value": "send" }
```

Show when `operation === "send"`.

```json
{ "field": "operation", "value": ["send", "reply"] }
```

Show when `operation` is "send" OR "reply".

```json
{ "field": "operation", "value": "delete", "not": true }
```

Show when `operation !== "delete"`.

## ToolManifest

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique tool ID. |
| `name` | string | Yes | Display name. |
| `description` | string | No | What the tool does. |
| `version` | string | Yes | Semantic version. |
| `executionMode` | "proxy" \| "direct" \| "handler" | Yes | How the tool executes. |
| `params` | Record<string, ParamDef> | Yes | Input parameters. |
| `outputs` | Record<string, OutputDef> | No | Output definitions. |
| `proxy` | ProxySpec | For proxy mode | Handler and operation name. |

### ParamDef

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | "string", "number", "boolean", "json", "array", etc. |
| `required` | boolean | Whether the param is required. |
| `default` | any | Default value. |
| `description` | string | Human-readable description. |
| `enum` | string[] | Allowed values. |

## TriggerManifest

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Trigger ID. |
| `name` | string | Yes | Display name. |
| `provider` | string | Yes | Provider identifier. |
| `webhook` | object | No | Webhook method configuration. |
| `credentials` | CredentialField[] | Yes | Required credential fields. |
| `auth` | AuthSpec | No | Webhook verification method. |
| `instructions` | string | No | Setup instructions shown to user. |
| `outputs` | object | Yes | Data the trigger provides to the workflow. |
