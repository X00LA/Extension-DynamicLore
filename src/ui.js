import { extension_settings } from "../../../../scripts/extensions.js";
import { addWorldInfoEntry, updateWorldInfoEntry } from "./functions.js";

// Create UI elements
export function createUI() {
    // Create menu button
    const menuButton = document.createElement('div');
    menuButton.id = 'dynamicLore_button';
    menuButton.className = 'list-group-item';
    menuButton.innerHTML = '<span>DynamicLore</span>';

    // Add menu button to extensions menu
    const extensionsMenu = document.getElementById('extensionsMenu');
    if (extensionsMenu) {
        extensionsMenu.appendChild(menuButton);
    }

    // Create panel
    const panel = document.createElement('div');
    panel.id = 'dynamiclore_panel';
    panel.className = 'drawer wide_drawer';
    panel.style.display = 'none';

    // Create panel header
    const header = document.createElement('div');
    header.className = 'drawer-header';
    header.innerHTML = `
        <span class="drawer_heading">DynamicLore - World Info Manager</span>
        <div class="menu_button fa-solid fa-xmark" id="dynamiclore_close"></div>
    `;

    // Create panel content
    const content = document.createElement('div');
    content.className = 'drawer-content';

    const controls = document.createElement('div');
    controls.className = 'dynamiclore_controls';
    controls.innerHTML = '<button id="dynamiclore_analyze" class="menu_button">Analyze Conversation</button>';

    const updates = document.createElement('div');
    updates.className = 'dynamiclore_pending_updates';
    updates.id = 'dynamiclore_updates';

    // Assemble panel
    content.appendChild(controls);
    content.appendChild(updates);
    panel.appendChild(header);
    panel.appendChild(content);

    // Add panel to body
    document.body.appendChild(panel);

    // Setup event handlers
    menuButton.addEventListener('click', () => {
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });

    document.getElementById('dynamiclore_close')?.addEventListener('click', () => {
        panel.style.display = 'none';
    });
}

export function showNewEntryProposal(entry) {
    const updatesList = document.getElementById('dynamiclore_updates');
    if (!updatesList) return;

    const entryElement = document.createElement('div');
    entryElement.className = 'dynamiclore_entry';
    entryElement.innerHTML = `
        <h4>New Entry Proposed</h4>
        <p><strong>Type:</strong> ${entry.type}</p>
        <p><strong>Name:</strong> ${entry.name}</p>
        <p><strong>Keys:</strong> ${entry.suggestedKeys.join(', ')}</p>
        <p><strong>Description:</strong></p>
        <pre>${entry.description}</pre>
        <p><strong>Confidence:</strong> ${(entry.confidence * 100).toFixed(1)}%</p>
        <div class="dynamiclore_actions">
            <button class="menu_button accept">Accept</button>
            <button class="menu_button reject">Reject</button>
        </div>
    `;

    // Add event listeners
    const acceptButton = entryElement.querySelector('.accept');
    const rejectButton = entryElement.querySelector('.reject');

    acceptButton?.addEventListener('click', () => {
        addWorldInfoEntry(entry);
        entryElement.remove();
    });

    rejectButton?.addEventListener('click', () => {
        entryElement.remove();
    });

    updatesList.appendChild(entryElement);
}

export function showUpdateProposal(entry) {
    const updatesList = document.getElementById('dynamiclore_updates');
    if (!updatesList) return;

    const entryElement = document.createElement('div');
    entryElement.className = 'dynamiclore_entry';
    entryElement.innerHTML = `
        <h4>Update Proposed</h4>
        <p><strong>Name:</strong> ${entry.name}</p>
        <p><strong>Original Content:</strong></p>
        <pre>${entry.originalContent}</pre>
        <p><strong>New Content:</strong></p>
        <pre>${entry.newContent}</pre>
        <p><strong>Merged Content:</strong></p>
        <pre>${entry.mergedContent}</pre>
        <div class="dynamiclore_actions">
            <button class="menu_button accept">Accept</button>
            <button class="menu_button reject">Reject</button>
        </div>
    `;

    // Add event listeners
    const acceptButton = entryElement.querySelector('.accept');
    const rejectButton = entryElement.querySelector('.reject');

    acceptButton?.addEventListener('click', () => {
        updateWorldInfoEntry(entry);
        entryElement.remove();
    });

    rejectButton?.addEventListener('click', () => {
        entryElement.remove();
    });

    updatesList.appendChild(entryElement);
}
