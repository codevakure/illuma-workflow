/**
 * HubSpot webhook event matching utilities.
 * Used by the webhook processor to filter events based on trigger configuration.
 */

/**
 * Check if a HubSpot event matches the expected trigger configuration.
 */
export function isHubSpotContactEventMatch(triggerId: string, eventType: string): boolean {
  const eventMap: Record<string, string> = {
    hubspot_contact_created: 'contact.creation',
    hubspot_contact_deleted: 'contact.deletion',
    hubspot_contact_privacy_deleted: 'contact.privacyDeletion',
    hubspot_contact_property_changed: 'contact.propertyChange',
    hubspot_company_created: 'company.creation',
    hubspot_company_deleted: 'company.deletion',
    hubspot_company_property_changed: 'company.propertyChange',
    hubspot_conversation_creation: 'conversation.creation',
    hubspot_conversation_deletion: 'conversation.deletion',
    hubspot_conversation_new_message: 'conversation.newMessage',
    hubspot_conversation_privacy_deletion: 'conversation.privacyDeletion',
    hubspot_conversation_property_changed: 'conversation.propertyChange',
    hubspot_deal_created: 'deal.creation',
    hubspot_deal_deleted: 'deal.deletion',
    hubspot_deal_property_changed: 'deal.propertyChange',
    hubspot_ticket_created: 'ticket.creation',
    hubspot_ticket_deleted: 'ticket.deletion',
    hubspot_ticket_property_changed: 'ticket.propertyChange',
  }

  const expectedEventType = eventMap[triggerId]
  if (!expectedEventType) {
    return true
  }

  return expectedEventType === eventType
}
