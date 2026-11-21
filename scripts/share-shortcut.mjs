// "Save to CookBook" share-sheet Shortcut. It sends the shared page's link to
// CookBook's import dialog (?share-url=). No account data or credentials belong here.
import { randomUUID } from 'node:crypto';

export function buildShareShortcut(siteUrl) {
    const site = new URL(siteUrl);
    if (site.protocol !== 'https:' && site.hostname !== 'localhost') throw new Error('Use the https address of your CookBook website.');
    site.search = ''; site.hash = '';
    const actions = [];
    const attachment = value => ({ Value: value, WFSerializationType: 'WFTextTokenAttachment' });
    const output = (id, name) => attachment({ Type: 'ActionOutput', OutputUUID: id, OutputName: name });
    const template = (...parts) => {
        let string = ''; const attachmentsByRange = {};
        for (const part of parts) {
            if (typeof part === 'string') string += part;
            else { attachmentsByRange[`{${string.length}, 1}`] = part.Value; string += '￼'; }
        }
        return { Value: { string, attachmentsByRange }, WFSerializationType: 'WFTextTokenString' };
    };
    const add = (name, params = {}) => {
        const id = randomUUID().toUpperCase();
        actions.push({ WFWorkflowActionIdentifier: 'is.workflow.actions.' + name, WFWorkflowActionParameters: { ...params, UUID: id } });
        return id;
    };
    add('comment', { WFCommentActionText: 'Save to CookBook: share a recipe page, YouTube video, TikTok or Instagram post to open it in CookBook’s import dialog. To use another CookBook address, edit the Text action below.' });
    const address = output(add('gettext', { WFTextActionText: site.href }), 'Text');
    const input = attachment({ Type: 'ExtensionInput' });
    const links = output(add('detect.link', { WFInput: input }), 'URLs');
    const first = output(add('getitemfromlist', { WFInput: links, WFItemSpecifier: 'First Item' }), 'Item from List');
    const group = randomUUID().toUpperCase();
    add('conditional', { GroupingIdentifier: group, WFControlFlowMode: 0, WFCondition: 101, WFInput: { Type: 'Variable', Variable: first } });
    add('alert', { WFAlertActionTitle: 'Save to CookBook', WFAlertActionMessage: 'Share a web page or video link.', WFAlertActionCancelButtonShown: false });
    add('exit');
    add('conditional', { GroupingIdentifier: group, WFControlFlowMode: 2 });
    const encoded = output(add('urlencode', { WFInput: template(first), WFEncodeMode: 'Encode' }), 'URL Encoded Text');
    add('openurl', { WFInput: template(address, '?share-url=', encoded) });
    return {
        WFWorkflowName: 'Save to CookBook', WFWorkflowClientVersion: '4000', WFWorkflowMinimumClientVersion: 900,
        WFWorkflowMinimumClientVersionString: '900', WFWorkflowIcon: { WFWorkflowIconStartColor: 431817727, WFWorkflowIconGlyphNumber: 59511 },
        WFWorkflowInputContentItemClasses: ['WFURLContentItem', 'WFSafariWebPageContentItem', 'WFStringContentItem'], WFWorkflowOutputContentItemClasses: [],
        WFWorkflowTypes: ['ActionExtension'], WFWorkflowImportQuestions: [], WFWorkflowHasShortcutInputVariables: true, WFWorkflowActions: actions,
    };
}
