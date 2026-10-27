import { describe, expect, spyOn, test } from 'bun:test';
import {
    Collection,
    ComponentType,
    ModalSubmitFields,
    type Attachment,
    type ActionRowModalData,
    type LabelModalData,
} from 'discord.js';
import { spamTicket } from '../src/features/tickets/config/options/spam.js';
import { generalTicket } from '../src/features/tickets/config/options/general.js';
import { readTicketModal } from '../src/features/tickets/services/ticketModal.js';
import { execute } from '../src/features/tickets/events/ticketInteraction.js';
import ticketService from '../src/features/tickets/services/ticketService.js';
import { TicketAttachmentError } from '../src/features/tickets/services/ticketAttachments.js';

// Exercise the SDK's actual field extraction; its runtime constructor is marked private in typings.
const TestModalFields = ModalSubmitFields as unknown as new (
    components: (ActionRowModalData | LabelModalData)[],
) => ModalSubmitFields;

describe('ticket form submissions', () => {
    test('the spam form has an optional file upload and preserves readable text labels', () => {
        const modal = spamTicket.modal!.toJSON();
        expect(modal.components).toHaveLength(3);
        const upload = modal.components[2];
        expect(upload.type).toBe(ComponentType.Label);
        if (upload.type !== ComponentType.Label) throw new Error('Expected upload label');
        expect(upload.component).toMatchObject({
            type: ComponentType.FileUpload,
            custom_id: 'screenshots',
            required: false,
            min_values: 0,
            max_values: 3,
        });
        const screenshot = { id: '123', name: 'proof.png' } as Attachment;
        const fields = new TestModalFields([
            {
                id: 2,
                type: ComponentType.Label,
                component: {
                    id: 3,
                    type: ComponentType.TextInput,
                    customId: 'reported_user',
                    value: 'spammer',
                },
            },
            {
                id: 4,
                type: ComponentType.Label,
                component: {
                    id: 5,
                    type: ComponentType.TextInput,
                    customId: 'reason',
                    value: 'Unsolicited advertising in DMs',
                },
            },
            {
                id: 6,
                type: ComponentType.Label,
                component: {
                    id: 7,
                    type: ComponentType.FileUpload,
                    customId: 'screenshots',
                    values: ['123'],
                    attachments: new Collection([['123', screenshot]]),
                },
            },
        ]);
        expect(readTicketModal(fields, spamTicket.modal)).toEqual({
            answers: [
                { question: 'Usuario / User', answer: 'spammer' },
                { question: 'Detalles / Details', answer: 'Unsolicited advertising in DMs' },
            ],
            attachments: [screenshot],
        });
    });

    test('accepts an empty upload and the old spam form opened before deployment', () => {
        for (const uploaded of [true, false]) {
            const fields = new TestModalFields([
                {
                    id: 8,
                    type: ComponentType.ActionRow,
                    components: [
                        {
                            id: 9,
                            type: ComponentType.TextInput,
                            customId: 'reported_user',
                            value: 'user',
                        },
                        {
                            id: 10,
                            type: ComponentType.TextInput,
                            customId: 'reason',
                            value: 'spam context',
                        },
                    ],
                },
                ...(uploaded
                    ? [
                          {
                              id: 11,
                              type: ComponentType.Label as const,
                              component: {
                                  id: 12,
                                  type: ComponentType.FileUpload as const,
                                  customId: 'screenshots',
                                  values: [],
                                  attachments: new Collection<string, Attachment>(),
                              },
                          },
                      ]
                    : []),
            ]);
            const submission = readTicketModal(fields, spamTicket.modal);
            expect(submission.answers).toHaveLength(2);
            expect(submission.attachments).toEqual([]);
        }
    });

    test('legacy general ticket fields keep their configured labels and ignore extra uploads', () => {
        const json = generalTicket.modal!.toJSON();
        const row = json.components[0];
        if (row.type !== ComponentType.ActionRow) throw new Error('Expected legacy row');
        const input = row.components[0];
        const fields = new TestModalFields([
            {
                id: 13,
                type: ComponentType.ActionRow,
                components: [
                    {
                        id: 14,
                        type: ComponentType.TextInput,
                        customId: input.custom_id,
                        value: 'General help request',
                    },
                ],
            },
            {
                id: 15,
                type: ComponentType.Label,
                component: {
                    id: 16,
                    type: ComponentType.FileUpload,
                    customId: 'unexpected',
                    values: [],
                    attachments: new Collection(),
                },
            },
        ]);
        expect(readTicketModal(fields, generalTicket.modal)).toEqual({
            answers: [{ question: input.label ?? input.custom_id, answer: 'General help request' }],
            attachments: [],
        });
    });

    test('the interaction forwards uploaded files and reports actionable validation errors privately', async () => {
        const screenshot = { id: '123', name: 'proof.png' } as Attachment;
        const fields = new TestModalFields([
            {
                id: 17,
                type: ComponentType.Label,
                component: {
                    id: 18,
                    type: ComponentType.TextInput,
                    customId: 'reported_user',
                    value: 'spammer',
                },
            },
            {
                id: 19,
                type: ComponentType.Label,
                component: {
                    id: 20,
                    type: ComponentType.TextInput,
                    customId: 'reason',
                    value: 'Repeated unsolicited adverts',
                },
            },
            {
                id: 21,
                type: ComponentType.Label,
                component: {
                    id: 22,
                    type: ComponentType.FileUpload,
                    customId: 'screenshots',
                    values: ['123'],
                    attachments: new Collection([['123', screenshot]]),
                },
            },
        ]);
        let deferredPrivately = false;
        let reply = '';
        const interaction = {
            customId: 'ticket_modal_spam',
            user: { id: 'reporter' },
            guild: { id: 'guild' },
            fields,
            isButton: () => false,
            isModalSubmit: () => true,
            deferReply: async (options: { ephemeral: boolean }) => {
                deferredPrivately = options.ephemeral;
            },
            editReply: async (message: string) => {
                reply = message;
            },
        };
        const create = spyOn(ticketService, 'createTicket').mockRejectedValue(
            new TicketAttachmentError('Las capturas deben ser imágenes PNG, JPG, WebP o GIF.'),
        );
        try {
            await execute(interaction as never, { logger: { error: () => {} } } as never);
            expect(deferredPrivately).toBe(true);
            expect(create).toHaveBeenCalledWith(
                interaction.user,
                interaction.guild,
                spamTicket,
                [
                    { question: 'Usuario / User', answer: 'spammer' },
                    { question: 'Detalles / Details', answer: 'Repeated unsolicited adverts' },
                ],
                [screenshot],
            );
            expect(reply).toContain('PNG');
        } finally {
            create.mockRestore();
        }
    });
});
