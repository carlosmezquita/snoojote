import { EmbedBuilder } from 'discord.js';
import { type WaitEstimateStatus } from '../services/responseTimeService.js';
import { formatDuration } from '../services/waitTimeEstimator.js';

/** Keep essential factors visible; only the potentially large staff/role lists are shortened. */
function boundedList(lines: string[]): string {
    if (!lines.length) return 'Ninguno';
    const kept: string[] = [];
    let length = 0;
    for (const line of lines) {
        if (length + line.length + 1 > 850) break;
        kept.push(line);
        length += line.length + 1;
    }
    if (kept.length < lines.length) kept.push(`… ${lines.length - kept.length} más.`);
    return kept.join('\n');
}

export function createWaitEstimateReport(status: WaitEstimateStatus, details = false) {
    const { estimate, queueLength, statusBreakdown: presence } = status;
    const f = estimate.factors;
    const samples = f.sampleCounts;
    const active = presence.online + presence.idle + presence.dnd + presence.busy;
    const warnings: string[] = [];
    if (!status.membershipReady)
        warnings.push('No se han podido cargar los miembros; las presencias están incompletas.');
    if (status.missingRoleIds.length)
        warnings.push(
            `${status.missingRoleIds.length} roles de staff configurados no encontrados.`,
        );
    if (!samples.recent && !samples.global && !samples.temporal)
        warnings.push(
            `Sin respuestas válidas en el historial consultado: se usa una base predeterminada de ${formatDuration(f.globalTemporalBaseMs)}.`,
        );
    const summary = new EmbedBuilder()
        .setTitle('Espera para un ticket nuevo')
        .setColor(warnings.length ? 0xe67e22 : 0x3498db)
        .setDescription(
            [
                'Estimación orientativa de la **primera respuesta del equipo** para un ticket que se abra ahora.',
                'No mide la resolución del caso ni el tiempo restante de un ticket ya abierto. El equipo es voluntario; puede tardar más.',
                ...warnings.map((warning) => `⚠️ ${warning}`),
            ].join('\n\n'),
        )
        .addFields(
            {
                name: 'Primera respuesta estimada',
                value: formatDuration(estimate.estimatedMs),
                inline: true,
            },
            { name: 'Solicitudes sin respuesta', value: String(queueLength), inline: true },
            {
                name: 'Staff con presencia activa',
                value: `${active} de ${status.staffProfiles.length}`,
                inline: true,
            },
            {
                name: 'Capacidad por presencia',
                value: `${f.currentStaffCapacity.toFixed(2)} equivalentes (online 1; idle 0,5; dnd 0,25)`,
                inline: false,
            },
            {
                name: 'Historial consultado',
                value: `Recientes: ${samples.recent} · Global: ${samples.global}\nMisma franja en Madrid: ${samples.temporal}${samples.temporal < 5 ? ' (mínimo 5 para aplicarla)' : ''}`,
                inline: false,
            },
            {
                name: 'Cómo leer la cola',
                value: 'Incluye tickets abiertos y en creación sin respuesta; excluye solicitantes no disponibles. No implica un orden de atención garantizado.',
                inline: false,
            },
        )
        .setFooter({
            text: details
                ? 'La presencia de Discord no garantiza disponibilidad real.'
                : 'La presencia no garantiza disponibilidad. Más información: /ticket wait details:true',
        });
    if (!details) return [summary];

    const pool = new Map(f.responderPool.map((entry) => [entry.staffId, entry]));
    const staff = status.staffProfiles.map((profile) => {
        const entry = pool.get(profile.staffId);
        return `<@${profile.staffId}> · ${profile.status} · ${
            entry
                ? `peso ${entry.weight.toFixed(2)} · n=${entry.sampleCount} · base ${entry.usesStaffBaseline ? 'personal' : 'general'}`
                : 'fuera del grupo activo'
        }`;
    });
    const duration = (value: number | null) =>
        value == null ? 'sin muestras suficientes' : `${Math.round(value)} ms`;
    const diagnostic = new EmbedBuilder()
        .setTitle('Factores del estimador')
        .setColor(0x3498db)
        .addFields(
            { name: 'Modelo', value: f.modelVersion },
            {
                name: 'Bases de primera respuesta',
                value: [
                    `Reciente: ${duration(f.recentMedianMs)}`,
                    `Misma franja: ${duration(f.temporalMedianMs)}`,
                    `Global: ${duration(f.globalMedianMs)}`,
                    `Global/temporal combinada: ${duration(f.globalTemporalBaseMs)}`,
                    `Staff activo: ${duration(f.activeStaffBaseMs)} (peso ${(100 * f.activeStaffBlendWeight).toFixed(1)} %)`,
                ].join('\n'),
            },
            {
                name: 'Cálculo y carga',
                value: [
                    `Base combinada: ${Math.round(f.blendedBaseMs)} ms`,
                    `Carga actual: ${f.currentLoad.toFixed(2)} · referencia histórica: ${f.historicalBaselineLoad.toFixed(2)}`,
                    `Multiplicador: ${f.loadMultiplier.toFixed(2)}×`,
                    `Resultado: ${Math.round(estimate.estimatedMs)} ms (limitado entre 1 min y 24 h; 24 h se muestra como 24+ h)`,
                ].join('\n'),
            },
            {
                name: 'Presencias del gateway',
                value: [
                    `Online ${presence.online} · idle ${presence.idle} · dnd ${presence.dnd + presence.busy} · offline/invisible ${presence.offline + presence.invisible} · desconocida ${presence.unknown}`,
                    `${status.fromCache ? 'Instantánea reutilizada' : 'Instantánea recalculada'}: <t:${Math.floor(status.staffFetchedAt / 1000)}:R>.`,
                    'Recalcular usa la caché de miembros/presencias del gateway; no consulta la disponibilidad real de cada persona.',
                ].join('\n'),
            },
            { name: 'Staff detectado y ponderación', value: boundedList(staff) },
            {
                name: 'Roles configurados no encontrados',
                value: boundedList(status.missingRoleIds.map((id) => `\`${id}\``)),
            },
        )
        .setFooter({
            text: 'Historial: 20 respuestas recientes; hasta 5.000 respuestas en 60 días; perfiles de staff: 90 días. Datos históricos con caché.',
        });
    return [summary, diagnostic];
}
