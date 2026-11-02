// Apple Shortcuts workflow source. No household data or reusable account credentials belong here.
import { randomUUID } from 'node:crypto';

export function buildRemindersShortcut() {
    const actions = [];
    const attachment = value => ({ Value: value, WFSerializationType: 'WFTextTokenAttachment' });
    const output = (id, name = 'Dictionary Value') => attachment({ Type: 'ActionOutput', OutputUUID: id, OutputName: name });
    const variable = name => attachment({ Type: 'Variable', VariableName: name });
    const template = (...parts) => {
        let string = ''; const attachmentsByRange = {};
        for (const part of parts) {
            if (typeof part === 'string') string += part;
            else { attachmentsByRange[`{${string.length}, 1}`] = part.Value; string += '\uFFFC'; }
        }
        return { Value: { string, attachmentsByRange }, WFSerializationType: 'WFTextTokenString' };
    };
    const add = (name, params = {}) => {
        const id = randomUUID().toUpperCase();
        actions.push({ WFWorkflowActionIdentifier: 'is.workflow.actions.' + name, WFWorkflowActionParameters: { ...params, UUID: id } });
        return id;
    };
    const value = (key, input) => output(add('getvalueforkey', { WFGetDictionaryValueType: 'Value', WFDictionaryKey: key, WFInput: input }));
    const set = (name, input) => add('setvariable', { WFVariableName: name, WFInput: input });
    const alert = message => add('alert', { WFAlertActionTitle: 'CookBook Groceries', WFAlertActionMessage: message, WFAlertActionCancelButtonShown: false });
    const condition = (input, code, literal) => {
        const group = randomUUID().toUpperCase();
        add('conditional', { GroupingIdentifier: group, WFControlFlowMode: 0, WFCondition: code, WFInput: { Type: 'Variable', Variable: input }, ...(literal === undefined ? {} : { WFConditionalActionString: literal }) });
        return group;
    };
    const end = group => add('conditional', { GroupingIdentifier: group, WFControlFlowMode: 2 });
    const missing = (input, message) => { const group = condition(input, 101); alert(message); add('exit'); end(group); };
    const stopOnError = response => { const error = value('error', response), group = condition(error, 100); alert(template(error)); add('exit'); end(group); };
    const startRepeat = input => { const group = randomUUID().toUpperCase(); add('repeat.each', { GroupingIdentifier: group, WFControlFlowMode: 0, WFInput: input }); return group; };
    const finishRepeat = group => output(add('repeat.each', { GroupingIdentifier: group, WFControlFlowMode: 2 }), 'Repeat Results');
    const row = (property, operator, values) => ({ Property: property, Operator: operator, Values: values, Removable: true });
    const find = (list, marker, incomplete = false, completed = false) => output(add('filter.reminders', {
        WFContentItemInputParameter: 'Library',
        WFContentItemFilter: { Value: { WFActionParameterFilterPrefix: 1, WFContentPredicateBoundedDate: false, WFActionParameterFilterTemplates: [
            row('List', 4, { Enumeration: template(list) }), row('Notes', 99, { String: template(marker) }),
            ...(incomplete || completed ? [row('Is Completed', 4, { Bool: completed })] : []),
        ] }, WFSerializationType: 'WFContentPredicateTableTemplate' },
    }), 'Reminders');
    const linked = (list, marker, legacy) => {
        set('Linked reminders', find(list, marker));
        const none = condition(variable('Linked reminders'), 101);
        // Only unfinished v1 reminders are adopted; completed v1 rows could belong to an old shop.
        set('Linked reminders', find(list, legacy, true)); end(none);
        return variable('Linked reminders');
    };
    const count = input => output(add('count', { WFCountType: 'Items', Input: input }), 'Count');
    const header = {
        Value: { WFDictionaryFieldValueItems: [{ WFItemType: 0, WFKey: template('Content-Type'), WFValue: template('application/json') }] },
        WFSerializationType: 'WFDictionaryFieldValue',
    };
    const post = (url, body) => {
        const file = output(add('gettext', { WFTextActionText: body }), 'Text');
        const result = output(add('downloadurl', { WFURL: template(url), WFHTTPMethod: 'POST', WFHTTPHeaders: header, WFHTTPBodyType: 'File', WFRequestVariable: file }), 'Contents of URL');
        stopOnError(result); return result;
    };
    add('comment', { WFCommentActionText: 'Two-way CookBook grocery sync, version 2. Start with Sync groceries on the website. This reads only linked reminders, exchanges checkmarks through a signed grocery-only scope that expires after 15 minutes, updates Reminders, then acknowledges completion. It never deletes reminders or changes pantry quantities. CookBook edits win when both sides changed a checkmark. Keep its marker in each reminder’s notes.' });
    const input = attachment({ Type: 'ExtensionInput' });
    missing(input, 'Open CookBook’s Shopping page and tap Sync groceries.');
    const root = output(add('detect.dictionary', { WFInput: input }), 'Dictionary');
    missing(value('signature', root), 'This Shortcut needs a fresh two-way sync. Open CookBook and tap Sync groceries.');
    const scope = value('scope', root), list = value('list', scope), items = value('items', scope);
    missing(items, 'There are no groceries to sync.');
    const read = startRepeat(items), item = variable('Repeat Item');
    const marker = value('marker', item), legacy = value('legacyMarker', item);
    const all = linked(list, marker, legacy), total = count(all), complete = count(find(list, marker, false, true));
    // Markers are generated from UUIDs/percent-encoded keys; they contain no JSON metacharacters.
    add('gettext', { WFTextActionText: template('{"marker":"', marker, '","count":', total, ',"completed":', complete, '}') });
    const rows = finishRepeat(read);
    const combined = output(add('text.combine', { text: rows, WFTextSeparator: 'Custom', WFTextCustomSeparator: ',', ShowWhenRun: false }), 'Combined Text');
    const finishUrl = value('finishUrl', root);
    const merged = post(finishUrl, template('{"payload":', input, ',"observations":[', combined, ']}'));
    missing(value('syncId', merged), 'CookBook could not confirm this sync. Start a fresh sync from the website.');
    const writes = value('items', merged), write = startRepeat(writes);
    const targetMarker = value('marker', item), targetLegacy = value('legacyMarker', item), title = value('title', item), notes = value('notes', item), checked = value('checked', item);
    const targets = linked(list, targetMarker, targetLegacy), absent = condition(targets, 101);
    const created = output(add('addnewreminder', { WFCalendarItemTitle: template(title), WFCalendarItemNotes: template(notes), WFCalendarDescriptor: list, WFAlertEnabled: 'No Alert' }), 'New Reminder');
    set('Linked reminders', created); end(absent);
    add('setters.reminders', { Mode: 'Set', WFInput: targets, WFContentItemPropertyName: 'Title', WFReminderContentItemTitle: template(title) });
    add('setters.reminders', { Mode: 'Set', WFInput: targets, WFContentItemPropertyName: 'Notes', WFReminderContentItemNotes: template(notes) });
    add('setters.reminders', { Mode: 'Set', WFInput: targets, WFContentItemPropertyName: 'Is Completed', WFReminderContentItemIsCompleted: checked });
    finishRepeat(write);
    const ackUrl = value('ackUrl', root), acknowledged = post(ackUrl, template('{"payload":', input, '}'));
    missing(value('syncId', acknowledged), 'Checkmarks reached CookBook, but the final confirmation failed. Run Sync groceries again.');
    add('openurl', { WFInput: template(value('returnUrl', root)) });
    return {
        WFWorkflowName: 'CookBook Groceries', WFWorkflowClientVersion: '4000', WFWorkflowMinimumClientVersion: 900,
        WFWorkflowMinimumClientVersionString: '900', WFWorkflowIcon: { WFWorkflowIconStartColor: 431817727, WFWorkflowIconGlyphNumber: 59511 },
        WFWorkflowInputContentItemClasses: ['WFStringContentItem'], WFWorkflowOutputContentItemClasses: [],
        WFWorkflowTypes: [], WFWorkflowImportQuestions: [], WFWorkflowHasShortcutInputVariables: true, WFWorkflowActions: actions,
    };
}

export function shortcutPlist(workflow) {
    const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
    const encode = value => {
        if (typeof value === 'boolean') return value ? '<true/>' : '<false/>';
        if (typeof value === 'number') return `<integer>${value}</integer>`;
        if (typeof value === 'string') return `<string>${escape(value)}</string>`;
        if (Array.isArray(value)) return `<array>${value.map(encode).join('')}</array>`;
        return `<dict>${Object.entries(value).map(([key, item]) => `<key>${escape(key)}</key>${encode(item)}`).join('')}</dict>`;
    };
    return '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">' + encode(workflow) + '</plist>\n';
}
