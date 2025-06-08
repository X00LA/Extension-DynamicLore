import { extension_settings, getContext, eventSource, event_types } from "../../../../scripts/extensions.js";
import { getRequestHeaders } from "../../../../scripts/extensions.js";
import { saveSettingsDebounced } from "../../../../scripts/extensions.js";
import { registerSlashCommand } from "../../../../scripts/slash-commands.js";
import { world_info } from "../../../../scripts/world-info.js";
import { analyzeMessages } from "./dynamicLore.js";
import { createUI } from "./ui.js";
import { addWorldInfoEntry, updateWorldInfoEntry } from "./functions.js";

// Default settings
if (!extension_settings.dynamicLore) {
    extension_settings.dynamicLore = {
        auto_analyze: true,
        analysis_interval: 5,
        auto_approve: false,
        message_count: 0
    };
}

// Initialize module
jQuery(async () => {
    // Create UI elements
    createUI();

    // Register slash command
    registerSlashCommand('dynamiclore', (args) => {
        if (args.length > 0 && args[0] === 'analyze') {
            analyzeCurrentChat();
            return true;
        }
        // Toggle UI visibility
        $('#dynamiclore_panel').toggle();
        return true;
    });

    // Setup event listeners
    if (extension_settings.dynamicLore.auto_analyze) {
        setupMessageListeners();
    }
});

// Listen for messages to analyze
function setupMessageListeners() {
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, handleNewMessage);
    eventSource.on(event_types.USER_MESSAGE_RENDERED, handleNewMessage);
}

async function handleNewMessage() {
    extension_settings.dynamicLore.message_count++;

    // Check if we should analyze based on the interval
    if (extension_settings.dynamicLore.message_count >= extension_settings.dynamicLore.analysis_interval) {
        extension_settings.dynamicLore.message_count = 0;
        analyzeCurrentChat();
    }

    saveSettingsDebounced();
}

// Main analysis function
async function analyzeCurrentChat() {
    const chatHistory = getContext().chat;
    const results = await analyzeMessages(chatHistory);

    if (results.newEntries.length > 0) {
        handleNewEntries(results.newEntries);
    }

    if (results.updatedEntries.length > 0) {
        handleUpdatedEntries(results.updatedEntries);
    }
}

function handleNewEntries(entries) {
    if (extension_settings.dynamicLore.auto_approve) {
        entries.filter(e => e.confidence > 0.8).forEach(entry => {
            addWorldInfoEntry(entry);
        });

        entries.filter(e => e.confidence <= 0.8).forEach(entry => {
            showNewEntryProposal(entry);
        });
    } else {
        entries.forEach(entry => {
            showNewEntryProposal(entry);
        });
    }
}

function handleUpdatedEntries(entries) {
    if (extension_settings.dynamicLore.auto_approve) {
        entries.filter(e => e.confidence > 0.8).forEach(entry => {
            updateWorldInfoEntry(entry);
        });

        entries.filter(e => e.confidence <= 0.8).forEach(entry => {
            showUpdateProposal(entry);
        });
    } else {
        entries.forEach(entry => {
            showUpdateProposal(entry);
        });
    }
}

// Export for external use
export { analyzeCurrentChat };
