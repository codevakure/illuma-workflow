# Trigger Support

Some tool integrations can also act as workflow triggers — starting workflows when external events occur (e.g., a new Slack message, a GitHub push, a Stripe payment).

## Architecture Overview

Triggers are defined entirely within the block's `subBlocks` array using `"mode": "trigger"`. When a block is switched to trigger mode in the editor, only subBlocks with `mode: "trigger"` are displayed. All other subBlocks are hidden.

The trigger system has two main patterns:
- **Webhook-based**: External services POST to a generated webhook URL
- **Polling-based**: The system periodically polls an API for new data (Gmail, Outlook, IMAP, RSS)

## Adding Trigger Support to a Manifest

### Step 1: Enable Triggers in the Block

Add `triggerAllowed` and `triggers` to your block definition:

```json
{
  "id": "my_service",
  "block": {
    "type": "my_service",
    "triggerAllowed": true,
    "triggers": {
      "enabled": true,
      "available": ["my_service_webhook"]
    }
  }
}
```

- `triggerAllowed: true` — allows the block to switch to trigger mode
- `triggers.enabled: true` — enables the trigger system for this block
- `triggers.available` — array of trigger IDs this block supports

### Step 2: Add Trigger SubBlocks

All trigger configuration is defined as subBlocks with `"mode": "trigger"`. These subBlocks are only shown when the block is in trigger mode.

#### Standard Webhook Trigger Pattern

For most webhook-based triggers, use this pattern:

```json
{
  "subBlocks": [
    {
      "id": "webhookUrlDisplay",
      "type": "short-input",
      "title": "Webhook URL",
      "readOnly": true,
      "showCopyButton": true,
      "useWebhookUrl": true,
      "placeholder": "Webhook URL will be generated",
      "mode": "trigger"
    },
    {
      "id": "webhookSecret",
      "type": "short-input",
      "title": "Webhook Secret",
      "placeholder": "Enter the signing secret",
      "description": "Used to verify that webhook payloads come from the service.",
      "password": true,
      "required": false,
      "mode": "trigger"
    },
    {
      "id": "triggerSave",
      "type": "trigger-save",
      "title": "",
      "hideFromPreview": true,
      "mode": "trigger",
      "triggerId": "my_service_webhook"
    },
    {
      "id": "triggerInstructions",
      "type": "text",
      "title": "Setup Instructions",
      "hideFromPreview": true,
      "mode": "trigger",
      "default": "<div class='mb-3'><strong>1.</strong> Go to your service settings...</div>"
    }
  ]
}
```

#### SubBlock Properties Reference

| Property | Type | Description |
|----------|------|-------------|
| `mode` | `"trigger"` | **Required.** Marks this subBlock as trigger-only |
| `readOnly` | `boolean` | Makes the input non-editable (for webhook URL display) |
| `showCopyButton` | `boolean` | Adds a copy-to-clipboard button |
| `useWebhookUrl` | `boolean` | Auto-populates with the generated webhook URL |
| `hideFromPreview` | `boolean` | Hides from the workflow block preview on the canvas |
| `triggerId` | `string` | Links the trigger-save button to a specific trigger ID |
| `password` | `boolean` | Masks the input (for secrets, tokens) |
| `connectionDroppable` | `boolean` | Whether connections can be dropped onto this input |

#### SubBlock Types Used in Triggers

| Type | Usage |
|------|-------|
| `short-input` | Webhook URL (readOnly), secrets, tokens, IDs |
| `dropdown` | Trigger type selector (for multi-trigger blocks) |
| `switch` | Toggle options (e.g., include file attachments) |
| `text` | Setup instructions (supports HTML) |
| `code` | Payload examples, curl commands (with `readOnly`, `collapsible`) |
| `trigger-save` | Trigger save button (links to `triggerId`) |
| `oauth-input` | OAuth credential selector (with `serviceId`, `requiredScopes`) |

### Step 3: Define Trigger Outputs

The block's `outputs` section defines what data the trigger provides to downstream blocks. These become available as `<blockId.field>` references:

```json
{
  "outputs": {
    "event": { "type": "string", "description": "Event type" },
    "data": { "type": "json", "description": "Event payload" },
    "timestamp": { "type": "string", "description": "When the event occurred" }
  }
}
```

## Multi-Trigger Blocks

Some blocks support multiple trigger types (e.g., GitHub supports issue opened, PR merged, push, etc.). Use a `selectedTriggerId` dropdown and condition subBlocks on it:

```json
{
  "subBlocks": [
    {
      "id": "selectedTriggerId",
      "type": "dropdown",
      "title": "Trigger Event",
      "mode": "trigger",
      "options": [
        { "label": "Issue Opened", "value": "my_service_issue_opened" },
        { "label": "Issue Closed", "value": "my_service_issue_closed" },
        { "label": "General Webhook", "value": "my_service_webhook" }
      ],
      "required": true
    },
    {
      "id": "webhookUrlDisplay",
      "type": "short-input",
      "title": "Webhook URL",
      "readOnly": true,
      "showCopyButton": true,
      "useWebhookUrl": true,
      "placeholder": "Webhook URL will be generated",
      "mode": "trigger"
    },
    {
      "id": "triggerSave",
      "type": "trigger-save",
      "title": "",
      "hideFromPreview": true,
      "mode": "trigger",
      "triggerId": "my_service_webhook"
    },
    {
      "id": "triggerInstructions",
      "type": "text",
      "title": "Setup Instructions",
      "hideFromPreview": true,
      "mode": "trigger",
      "default": "<div class='mb-3'>Setup steps here...</div>"
    }
  ]
}
```

The `triggers.available` array in the block config must list all available trigger IDs:

```json
{
  "triggers": {
    "enabled": true,
    "available": [
      "my_service_issue_opened",
      "my_service_issue_closed",
      "my_service_webhook"
    ]
  }
}
```

## Trigger-Only Blocks

Some blocks exist solely as triggers (e.g., Circleback, RSS). For these:

- Set `"category": "triggers"` (instead of `"tools"`)
- All subBlocks should have `"mode": "trigger"`
- The `tools` section can be empty: `{ "access": [], "config": { "tool": "" } }`

```json
{
  "block": {
    "type": "circleback",
    "category": "triggers",
    "triggerAllowed": true,
    "subBlocks": [
      { "id": "webhookUrlDisplay", "mode": "trigger", "..." : "..." },
      { "id": "triggerSave", "mode": "trigger", "..." : "..." },
      { "id": "triggerInstructions", "mode": "trigger", "..." : "..." }
    ],
    "tools": { "access": [], "config": { "tool": "" } },
    "triggers": {
      "enabled": true,
      "available": ["circleback_webhook"]
    }
  }
}
```

## Polling-Based Triggers

For services that don't support webhooks (Gmail, Outlook, IMAP, RSS), use polling:

- Set trigger IDs with `_poller` suffix: `"gmail_poller"`, `"rss_poller"`
- No `webhookUrlDisplay` subBlock needed
- Polling configuration may include OAuth credentials or polling-specific fields

```json
{
  "triggers": {
    "enabled": true,
    "available": ["gmail_poller"]
  }
}
```

## Setup Instructions HTML

The `triggerInstructions` subBlock uses type `"text"` with HTML in `"default"`. Use this structure:

```html
<div class='mb-3'><strong>1.</strong> Go to your service settings page.</div>
<div class='mb-3'><strong>2.</strong> Navigate to Webhooks section.</div>
<div class='mb-3'><strong>3.</strong> Paste the <strong>Webhook URL</strong> above.</div>
<div class='mb-3'><strong>4.</strong> Copy the signing secret and paste it above.</div>
<div class='mb-3'><strong>5.</strong> Click <strong>Save Configuration</strong> above.</div>
```

Supported HTML elements: `<div>`, `<strong>`, `<a>` (with `target='_blank'`), `<code>`, `<ul>/<li>`.

## Complete Example: Stripe Webhook

```json
{
  "id": "stripe",
  "block": {
    "type": "stripe",
    "triggerAllowed": true,
    "triggers": {
      "enabled": true,
      "available": ["stripe_webhook"]
    },
    "subBlocks": [
      {
        "id": "webhookUrlDisplay",
        "type": "short-input",
        "title": "Webhook URL",
        "readOnly": true,
        "showCopyButton": true,
        "useWebhookUrl": true,
        "placeholder": "Webhook URL will be generated",
        "mode": "trigger"
      },
      {
        "id": "webhookSecret",
        "type": "short-input",
        "title": "Webhook Signing Secret",
        "placeholder": "whsec_...",
        "description": "The webhook signing secret from your Stripe dashboard.",
        "password": true,
        "required": true,
        "mode": "trigger"
      },
      {
        "id": "triggerSave",
        "type": "trigger-save",
        "title": "",
        "hideFromPreview": true,
        "mode": "trigger",
        "triggerId": "stripe_webhook"
      },
      {
        "id": "triggerInstructions",
        "type": "text",
        "title": "Setup Instructions",
        "hideFromPreview": true,
        "mode": "trigger",
        "default": "<div class='mb-3'><strong>1.</strong> Go to the Stripe Dashboard > Developers > Webhooks.</div><div class='mb-3'><strong>2.</strong> Click <strong>Add endpoint</strong>.</div><div class='mb-3'><strong>3.</strong> Paste the Webhook URL above.</div><div class='mb-3'><strong>4.</strong> Select the events to listen for.</div><div class='mb-3'><strong>5.</strong> Copy the Signing Secret and paste it above.</div>"
      }
    ]
  }
}
```

## Existing Trigger Integrations

### Webhook-based (20 integrations)
| Integration | Trigger IDs | Auth Pattern |
|-------------|-------------|--------------|
| Airtable | `airtable_webhook` | OAuth |
| Cal.com | 9 booking event triggers | Signing key |
| Calendly | 4 event triggers | Webhook secret |
| Circleback | 3 meeting event triggers | HMAC signing secret |
| Fireflies | `fireflies_transcription_complete` | Webhook URL only |
| GitHub | 12 event triggers | HMAC webhook secret |
| Google Forms | `google_forms_webhook` | Webhook URL only |
| Grain | 6 recording/highlight triggers | API key |
| HubSpot | 18 CRM event triggers | OAuth (clientId, clientSecret, appId) |
| Jira | 6 issue event triggers | Webhook secret |
| Lemlist | 9 campaign triggers | Webhook secret |
| Linear | 15 issue/project triggers | Webhook secret |
| Microsoft Teams | 2 triggers (webhook, chat) | Webhook URL only |
| Slack | `slack_webhook` | Signing secret + bot token |
| Stripe | `stripe_webhook` | Webhook signing secret |
| Telegram | `telegram_webhook` | Bot token |
| Twilio Voice | `twilio_voice_webhook` | Account SID |
| Typeform | `typeform_webhook` | Webhook secret |
| Webflow | 4 collection/form triggers | Webhook URL only |
| WhatsApp | `whatsapp_webhook` | Verification token |

### Polling-based (4 integrations)
| Integration | Trigger ID | Auth Pattern |
|-------------|-----------|--------------|
| Gmail | `gmail_poller` | OAuth |
| IMAP | `imap_poller` | IMAP credentials |
| Outlook | `outlook_poller` | OAuth |
| RSS | `rss_poller` | None |
