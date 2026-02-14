/**
 * Handler registration module.
 * Imports all dedicated handler modules and registers them with the handler registry.
 * This file is imported by tools.ts to ensure all handlers are registered at startup.
 */
import { registerServiceHandlers } from '@/routes/tool-proxy/handler-registry'

// Import all handler modules
import { slackHandlers } from '@/routes/tool-proxy/handlers/slack'
import { gmailHandlers } from '@/routes/tool-proxy/handlers/gmail'
import { discordHandlers } from '@/routes/tool-proxy/handlers/discord'
import { outlookHandlers } from '@/routes/tool-proxy/handlers/outlook'
import { postgresqlHandlers } from '@/routes/tool-proxy/handlers/postgresql'
import { mysqlHandlers } from '@/routes/tool-proxy/handlers/mysql'
import { mongodbHandlers } from '@/routes/tool-proxy/handlers/mongodb'
import { neo4jHandlers } from '@/routes/tool-proxy/handlers/neo4j'
import { dynamodbHandlers } from '@/routes/tool-proxy/handlers/dynamodb'
import { rdsHandlers } from '@/routes/tool-proxy/handlers/rds'
import { s3Handlers } from '@/routes/tool-proxy/handlers/s3'
import { sqsHandlers } from '@/routes/tool-proxy/handlers/sqs'
import { sshHandlers } from '@/routes/tool-proxy/handlers/ssh'
import { sftpHandlers } from '@/routes/tool-proxy/handlers/sftp'
import { sendgridHandlers } from '@/routes/tool-proxy/handlers/sendgrid'
import { smtpHandlers } from '@/routes/tool-proxy/handlers/smtp'
import { smsHandlers } from '@/routes/tool-proxy/handlers/sms'
import { telegramHandlers } from '@/routes/tool-proxy/handlers/telegram'
import { mailHandlers } from '@/routes/tool-proxy/handlers/mail'
import { microsoftTeamsHandlers } from '@/routes/tool-proxy/handlers/microsoft_teams'
import { microsoftTeamsListHandlers } from '@/routes/tool-proxy/handlers/microsoft-teams'
import { jiraHandlers } from '@/routes/tool-proxy/handlers/jira'
import { asanaHandlers } from '@/routes/tool-proxy/handlers/asana'
import { confluenceHandlers } from '@/routes/tool-proxy/handlers/confluence'
import { jsmHandlers } from '@/routes/tool-proxy/handlers/jsm'
import { googleDriveHandlers } from '@/routes/tool-proxy/handlers/google_drive'
import { dropboxHandlers } from '@/routes/tool-proxy/handlers/dropbox'
import { onedriveHandlers } from '@/routes/tool-proxy/handlers/onedrive'
import { sharepointHandlers } from '@/routes/tool-proxy/handlers/sharepoint'
import { supabaseHandlers } from '@/routes/tool-proxy/handlers/supabase'
import { wordpressHandlers } from '@/routes/tool-proxy/handlers/wordpress'
import { visionHandlers } from '@/routes/tool-proxy/handlers/vision'
import { ttsHandlers } from '@/routes/tool-proxy/handlers/tts'
import { sttHandlers } from '@/routes/tool-proxy/handlers/stt'
import { videoHandlers } from '@/routes/tool-proxy/handlers/video'
import { a2aHandlers } from '@/routes/tool-proxy/handlers/a2a'
import { stagehandHandlers } from '@/routes/tool-proxy/handlers/stagehand'
import { linearHandlers } from '@/routes/tool-proxy/handlers/linear'
import { githubHandlers } from '@/routes/tool-proxy/handlers/github'
import { googleCalendarHandlers } from '@/routes/tool-proxy/handlers/google_calendar'
import { googleSheetsHandlers } from '@/routes/tool-proxy/handlers/google_sheets'
import { googleVaultHandlers } from '@/routes/tool-proxy/handlers/google_vault'
import { imapHandlers } from '@/routes/tool-proxy/handlers/imap'
import { driveHandlers } from '@/routes/tool-proxy/handlers/drive'
import { pipedriveHandlers } from '@/routes/tool-proxy/handlers/pipedrive'
import { twilioHandlers } from '@/routes/tool-proxy/handlers/twilio'
import { zoomHandlers } from '@/routes/tool-proxy/handlers/zoom'
import { wealthboxHandlers } from '@/routes/tool-proxy/handlers/wealthbox'
import { webflowHandlers } from '@/routes/tool-proxy/handlers/webflow'
import { microsoftExcelHandlers } from '@/routes/tool-proxy/handlers/microsoft_excel'
import { microsoftPlannerHandlers } from '@/routes/tool-proxy/handlers/microsoft_planner'
import { reductoHandlers } from '@/routes/tool-proxy/handlers/reducto'
import { pulseHandlers } from '@/routes/tool-proxy/handlers/pulse'
import { mistralHandlers } from '@/routes/tool-proxy/handlers/mistral'
import { textractHandlers } from '@/routes/tool-proxy/handlers/textract'

// Register all service handlers
registerServiceHandlers('slack', slackHandlers)
registerServiceHandlers('gmail', gmailHandlers)
registerServiceHandlers('discord', discordHandlers)
registerServiceHandlers('outlook', outlookHandlers)
registerServiceHandlers('postgresql', postgresqlHandlers)
registerServiceHandlers('mysql', mysqlHandlers)
registerServiceHandlers('mongodb', mongodbHandlers)
registerServiceHandlers('neo4j', neo4jHandlers)
registerServiceHandlers('dynamodb', dynamodbHandlers)
registerServiceHandlers('rds', rdsHandlers)
registerServiceHandlers('s3', s3Handlers)
registerServiceHandlers('sqs', sqsHandlers)
registerServiceHandlers('ssh', sshHandlers)
registerServiceHandlers('sftp', sftpHandlers)
registerServiceHandlers('sendgrid', sendgridHandlers)
registerServiceHandlers('smtp', smtpHandlers)
registerServiceHandlers('sms', smsHandlers)
registerServiceHandlers('telegram', telegramHandlers)
registerServiceHandlers('mail', mailHandlers)
registerServiceHandlers('microsoft_teams', microsoftTeamsHandlers)
registerServiceHandlers('microsoft-teams', microsoftTeamsListHandlers)
registerServiceHandlers('jira', jiraHandlers)
registerServiceHandlers('asana', asanaHandlers)
registerServiceHandlers('confluence', confluenceHandlers)
registerServiceHandlers('jsm', jsmHandlers)
registerServiceHandlers('google_drive', googleDriveHandlers)
registerServiceHandlers('dropbox', dropboxHandlers)
registerServiceHandlers('onedrive', onedriveHandlers)
registerServiceHandlers('sharepoint', sharepointHandlers)
registerServiceHandlers('supabase', supabaseHandlers)
registerServiceHandlers('wordpress', wordpressHandlers)
registerServiceHandlers('vision', visionHandlers)
registerServiceHandlers('tts', ttsHandlers)
registerServiceHandlers('stt', sttHandlers)
registerServiceHandlers('video', videoHandlers)
registerServiceHandlers('a2a', a2aHandlers)
registerServiceHandlers('stagehand', stagehandHandlers)
registerServiceHandlers('linear', linearHandlers)
registerServiceHandlers('github', githubHandlers)
registerServiceHandlers('google_calendar', googleCalendarHandlers)
registerServiceHandlers('google_sheets', googleSheetsHandlers)
registerServiceHandlers('google_vault', googleVaultHandlers)
registerServiceHandlers('imap', imapHandlers)
registerServiceHandlers('drive', driveHandlers)
registerServiceHandlers('pipedrive', pipedriveHandlers)
registerServiceHandlers('twilio', twilioHandlers)
registerServiceHandlers('zoom', zoomHandlers)
registerServiceHandlers('wealthbox', wealthboxHandlers)
registerServiceHandlers('webflow', webflowHandlers)
registerServiceHandlers('microsoft_excel', microsoftExcelHandlers)
registerServiceHandlers('microsoft_planner', microsoftPlannerHandlers)
registerServiceHandlers('reducto', reductoHandlers)
registerServiceHandlers('pulse', pulseHandlers)
registerServiceHandlers('mistral', mistralHandlers)
registerServiceHandlers('textract', textractHandlers)
