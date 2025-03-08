import { callPopup } from "../../../scripts/extensions.js";
import { addWorldInfoEntry, updateWorldInfoEntry } from "./functions.js";

// Create UI elements
function createUI() {
    // Add menu button
    $('#extensionsMenu').append(`
        <div id="dynamicLore_button" class="list-group-item">
            <span>DynamicLore</span>
        </div>
    `);
    
    // Add floating panel
    $('body').append(`
        <div id="dynamiclore_panel" class="drawer wide_drawer" style="display: none;">
            <div class="drawer-header">
                <span class="drawer_heading">DynamicLore - World Info Manager</span>
                <div class="menu_button fa-solid fa-xmark" id="dynamiclore_close"></div>
            </div>
            <div class="drawer-content">
                <div class="dynamiclore_controls">
                    <button id="dynamiclore_analyze" class="menu_button">Analyze Conversation</button>
                </div>
                <div class="dynamiclore_pending_updates">
                    <h3>Pending Updates</h3>
                    <div id="dynamiclore_updates_list"></div>
                </div>
                <div class="dynamiclore_pending_entries">
                    <h3>Suggested New Entries</h3>
                    <div id="dynamiclore_entries_list"></div>
                </div>
            </div>
        </div>
    `);
    
    // Setup event handlers
    $('#dynamicLore_button').on('click', function() {
        $('#dynamiclore_panel').toggle();
    });
    
    $('#dynamiclore_close').on('click', function() {
        $('#dynamiclore_panel').hide();
    });
    
    $('#dynamiclore_analyze').on('click', function() {
        // Trigger analysis
        if (window.analyzeCurrentChat) {
            window.analyzeCurrentChat();
        }
    });
}

// Display a proposed update to an existing entry
function showUpdateProposal(entry) {
    const entryHtml = `
        <div class="dynamiclore_update_proposal" data-id="${entry.id}">
            <div class="dynamiclore_proposal_header">
                <strong>${entry.name}</strong> (${Math.round(entry.confidence * 100)}% confidence)
            </div>
            <div class="dynamiclore_proposal_content">
                <div class="dynamiclore_original">
                    <strong>Original:</strong>
                    <pre>${entry.originalContent}</pre>
                </div>
                <div class="dynamiclore_new">
                    <strong>New Information:</strong>
                    <pre>${entry.newContent}</pre>
                </div>
                <div class="dynamiclore_merged">
                    <strong>Merged:</strong>
                    <pre>${entry.mergedContent}</pre>
                </div>
            </div>
            <div class="dynamiclore_proposal_actions">
                <button class="dynamiclore_accept">Accept</button>
                <button class="dynamiclore_edit">Edit</button>
                <button class="dynamiclore_reject">Reject</button>
            </div>
        </div>
    `;
    
    $('#dynamiclore_updates_list').append(entryHtml);
    
    // Setup buttons
    $(`[data-id="${entry.id}"] .dynamiclore_accept`).on('click', function() {
        updateWorldInfoEntry(entry);
        $(`[data-id="${entry.id}"]`).remove();
    });
    
    $(`[data-id="${entry.id}"] .dynamiclore_edit`).on('click', function() {
        editMergedContent(entry);
    });
    
    $(`[data-id="${entry.id}"] .dynamiclore_reject`).on('click', function() {
        $(`[data-id="${entry.id}"]`).remove();
    });
}

// Display a proposed new entry
function showNewEntryProposal(entry) {
    const entryId = Date.now(); // Temporary ID
    const entryHtml = `
        <div class="dynamiclore_entry_proposal" data-id="${entryId}">
            <div class="dynamiclore_proposal_header">
                <strong>${entry.name}</strong> (${entry.type}, ${Math.round(entry.confidence * 100)}% confidence)
            </div>
            <div class="dynamiclore_proposal_content">
                <div class="dynamiclore_description">
                    <pre>${entry.description}</pre>
                </div>
                <div class="dynamiclore_keys">
                    <strong>Suggested Keys:</strong> ${entry.suggestedKeys.join(', ')}
                </div>
            </div>
            <div class="dynamiclore_proposal_actions">
                <button class="dynamiclore_accept">Accept</button>
                <button class="dynamiclore_edit">Edit</button>
                <button class="dynamiclore_reject">Reject</button>
            </div>
        </div>
    `;
    
    $('#dynamiclore_entries_list').append(entryHtml);
    
    // Setup buttons
    $(`[data-id="${entryId}"] .dynamiclore_accept`).on('click', function() {
        addWorldInfoEntry(entry);
        $(`[data-id="${entryId}"]`).remove();
    });
    
    $(`[data-id="${entryId}"] .dynamiclore_edit`).on('click', function() {
        editNewEntry(entry, entryId);
    });
    
    $(`[data-id="${entryId}"] .dynamiclore_reject`).on('click', function() {
        $(`[data-id="${entryId}"]`).remove();
    });
}

// Allow editing merged content
async function editMergedContent(entry) {
    const editedContent = await callPopup('<textarea id="merged_content_edit" style="width: 100%; height: 300px;">' + entry.mergedContent + '</textarea>', 'confirm');
    
    if (editedContent) {
        entry.mergedContent = $('#merged_content_edit').val();
        $(`[data-id="${entry.id}"] .dynamiclore_merged pre`).text(entry.mergedContent);
    }
}

// Allow editing a new entry
async function editNewEntry(entry, entryId) {
    const editResult = await callPopup(`
        <div>
            <label>Description:</label>
            <textarea id="entry_description_edit" style="width: 100%; height: 200px;">${entry.description}</textarea>
            <label>Keys (comma separated):</label>
            <input type="text" id="entry_keys_edit" value="${entry.suggestedKeys.join(', ')}" style="width: 100%">
        </div>
    `, 'confirm');
    
    if (editResult) {
        entry.description = $('#entry_description_edit').val();
        entry.suggestedKeys = $('#entry_keys_edit').val().split(',').map(k => k.trim());
        
        // Update the UI
        $(`[data-id="${entryId}"] .dynamiclore_description pre`).text(entry.description);
        $(`[data-id="${entryId}"] .dynamiclore_keys`).html(`<strong>Suggested Keys:</strong> ${entry.suggestedKeys.join(', ')}`);
    }
}

export { createUI, showUpdateProposal, showNewEntryProposal };
