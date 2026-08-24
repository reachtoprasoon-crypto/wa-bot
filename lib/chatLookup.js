/**
 * Chat/contact lookups that work around whatsapp-web.js's group metadata
 * sync issues.
 */

/**
 * Looks up group chats directly from WhatsApp Web's in-memory Store, instead
 * of client.getChats() — which calls groupMetadata.update() for every group
 * and fails outright if even one group's metadata hasn't synced yet. This
 * reads names/IDs already cached on the chat objects, so no network
 * round-trip (and thus no such failure) is needed.
 * @param {import('whatsapp-web.js').Client} client
 * @param {string} [query] Case-insensitive substring to filter names by.
 * @returns {Promise<Array<{name: string, id: string}>>}
 */
async function findGroupsInStore(client, query) {
  const q = (query || '').trim().toLowerCase();
  return client.pupPage.evaluate((q) => {
    const chats = window.require('WAWebCollections').Chat.getModelsArray();
    return chats
      .filter((chat) => !!chat.groupMetadata)
      .map((chat) => ({
        name: chat.formattedTitle || chat.name || '',
        id: chat.id._serialized,
      }))
      .filter((g) => !q || g.name.toLowerCase().includes(q));
  }, q);
}

/**
 * Resolve a phone number to WhatsApp's canonical chat ID via getNumberId,
 * rather than guessing `${phone}@c.us`. WhatsApp has been migrating some
 * accounts to privacy-preserving `@lid` addressing; a message sent to a
 * hand-built `@c.us` ID for one of those accounts can appear to succeed
 * (the send promise resolves without throwing) while never actually being
 * delivered, since it's the wrong identity for that contact.
 * @param {import('whatsapp-web.js').Client} client
 * @param {string} phone
 */
async function resolveChatId(client, phone) {
  let phoneFormatted = (phone || '').replace(/\D/g, '');
  if (phoneFormatted.length === 10) {
    phoneFormatted = `91${phoneFormatted}`;
  }
  const numberId = await client.getNumberId(phoneFormatted);
  if (!numberId) {
    throw new Error(`${phoneFormatted} is not registered on WhatsApp`);
  }
  return numberId._serialized;
}

module.exports = { findGroupsInStore, resolveChatId };
