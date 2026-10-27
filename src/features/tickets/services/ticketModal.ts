import {
    ComponentType,
    type Attachment,
    type ModalBuilder,
    type ModalSubmitFields,
} from 'discord.js';

/** Read configured fields only, supporting both legacy action rows and modal labels. */
export function readTicketModal(fields: ModalSubmitFields, modal?: ModalBuilder) {
    const answers: { question: string; answer: string }[] = [];
    const attachments: Attachment[] = [];
    for (const container of modal?.toJSON().components ?? []) {
        const inputs =
            container.type === ComponentType.ActionRow
                ? container.components
                : container.type === ComponentType.Label
                  ? [container.component]
                  : [];
        for (const input of inputs) {
            if (!('custom_id' in input)) continue;
            // A form opened before a deployment may not contain the new optional upload field.
            if (!fields.fields.has(input.custom_id)) continue;
            if (input.type === ComponentType.TextInput) {
                answers.push({
                    question:
                        container.type === ComponentType.Label
                            ? container.label
                            : (input.label ?? input.custom_id),
                    answer: fields.getTextInputValue(input.custom_id),
                });
            } else if (input.type === ComponentType.FileUpload) {
                attachments.push(...(fields.getUploadedFiles(input.custom_id)?.values() ?? []));
            }
        }
    }
    return { answers, attachments };
}
