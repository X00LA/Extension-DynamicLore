module.exports = {
  extensions: {
    extension_settings: {},
    getContext: () => ({ chat: [] }),
    eventSource: { on: () => {} },
    event_types: { CHARACTER_MESSAGE_RENDERED: 'event' },
    getRequestHeaders: () => ({}),
    saveSettingsDebounced: () => {},
    callPopup: async () => {}
  },
  worldInfo: {
    world_info: { entries: [] },
    getWorldInfoPrompt: () => ''
  },
  slashCommands: {
    registerSlashCommand: () => {}
  },
  textGeneration: {
    generateRaw: async () => '{}'
  }
};
