// =============================================================================
// Feedback Engine — Approval Engine Agent
// Processes human approvals and applies approved changes.
// Handles rollbacks, change logging, and post-apply verification.
// =============================================================================

const { insert, update, getOne, getAll, query, run, logSchedulerStart, logSchedulerEnd } = require('../db/fe-db');

const TAG = '[FE:ApprovalEngine]';

module.exports = function (config = {}) {

    // ── 1. approveProposal ─────────────────────────────────────────────────
    async function approveProposal(id, reviewedBy) {
        try {
            const proposal = getOne('fe_proposals', id);
            if (!proposal) throw new Error(`Proposal #${id} not found`);
            if (proposal.status !== 'pending') {
                throw new Error(`Proposal #${id} is ${proposal.status}, cannot approve`);
            }

            console.log(TAG, `Approving proposal #${id}: "${proposal.title}" (risk: ${proposal.risk_level})`);

            const now = new Date().toISOString();
            update('fe_proposals', id, {
                status: 'approved',
                reviewed_at: now,
                reviewed_by: reviewedBy || 'system'
            });

            // HIGH risk: delay application by 24 hours
            if (proposal.risk_level === 'high') {
                const delayedApplyAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
                update('fe_proposals', id, { applied_at: delayedApplyAt });
                console.log(TAG, `HIGH risk — scheduled apply at ${delayedApplyAt}`);
                return { id, status: 'approved', apply_scheduled: delayedApplyAt, delayed: true };
            }

            // LOW/MEDIUM risk: apply immediately
            const applyResult = await applyProposal(id);
            return { id, status: 'approved', applied: true, applyResult };

        } catch (err) {
            console.error(TAG, `approveProposal error for #${id}:`, err.message);
            throw err;
        }
    }

    // ── 2. rejectProposal ──────────────────────────────────────────────────
    async function rejectProposal(id, reason, reviewedBy) {
        try {
            const proposal = getOne('fe_proposals', id);
            if (!proposal) throw new Error(`Proposal #${id} not found`);
            if (proposal.status !== 'pending') {
                throw new Error(`Proposal #${id} is ${proposal.status}, cannot reject`);
            }

            console.log(TAG, `Rejecting proposal #${id}: "${proposal.title}" — reason: ${reason}`);

            const now = new Date().toISOString();
            update('fe_proposals', id, {
                status: 'rejected',
                reviewed_at: now,
                reviewed_by: reviewedBy || 'system',
                rationale: proposal.rationale + '\n\n[REJECTED] ' + (reason || 'No reason provided')
            });

            return { id, status: 'rejected', reason };

        } catch (err) {
            console.error(TAG, `rejectProposal error for #${id}:`, err.message);
            throw err;
        }
    }

    // ── 3. approveBatch ────────────────────────────────────────────────────
    async function approveBatch(ids, reviewedBy) {
        try {
            if (!Array.isArray(ids) || ids.length === 0) {
                throw new Error('ids must be a non-empty array');
            }

            console.log(TAG, `Batch approving ${ids.length} proposals`);
            const results = [];

            for (const id of ids) {
                try {
                    const result = await approveProposal(id, reviewedBy);
                    results.push({ id, success: true, ...result });
                } catch (err) {
                    console.error(TAG, `Batch approve failed for #${id}: ${err.message}`);
                    results.push({ id, success: false, error: err.message });
                }
            }

            const succeeded = results.filter(r => r.success).length;
            console.log(TAG, `Batch complete: ${succeeded}/${ids.length} approved`);
            return { total: ids.length, succeeded, results };

        } catch (err) {
            console.error(TAG, 'approveBatch error:', err.message);
            throw err;
        }
    }

    // ── 4. applyProposal ──────────────────────────────────────────────────
    async function applyProposal(id) {
        try {
            const proposal = getOne('fe_proposals', id);
            if (!proposal) throw new Error(`Proposal #${id} not found`);
            if (proposal.status !== 'approved') {
                throw new Error(`Proposal #${id} is ${proposal.status}, must be approved to apply`);
            }

            console.log(TAG, `Applying proposal #${id}: [${proposal.proposal_type}] ${proposal.title}`);

            // Snapshot current state before any change
            const snapshotData = await _captureSnapshot(proposal);
            const snapshotId = insert('fe_rollback_snapshots', {
                proposal_id: id,
                snapshot_type: proposal.proposal_type,
                snapshot_data_json: JSON.stringify(snapshotData),
                created_at: new Date().toISOString()
            });

            let changeDescription = '';
            let afterState = {};

            switch (proposal.proposal_type) {
                case 'WEIGHT_RECALIBRATION': {
                    // Parse proposed weights from description or evidence
                    const evidence = proposal.evidence_json ? JSON.parse(proposal.evidence_json) : {};
                    // Store the proposed weights as the new weight config
                    // The actual weight config lives in fe_audit_reports.proposed_weights_json
                    const latestAudit = query(
                        `SELECT * FROM fe_audit_reports ORDER BY id DESC LIMIT 1`
                    );
                    if (latestAudit.length > 0) {
                        const currentWeights = latestAudit[0].current_weights_json;
                        const proposedWeights = latestAudit[0].proposed_weights_json || currentWeights;
                        // Create new audit entry with recalibrated weights
                        insert('fe_audit_reports', {
                            audit_date: new Date().toISOString().split('T')[0],
                            meta_accuracy_pct: latestAudit[0].meta_accuracy_pct,
                            google_accuracy_pct: latestAudit[0].google_accuracy_pct,
                            current_weights_json: proposedWeights,
                            proposed_weights_json: null,
                            signal_analysis_json: JSON.stringify({ applied_from_proposal: id }),
                            proposals_generated: 0
                        });
                        afterState = { weights: proposedWeights };
                        changeDescription = `Recalibrated weights from proposal #${id}: applied proposed_weights as current_weights`;
                    } else {
                        changeDescription = `Weight recalibration skipped: no existing audit to recalibrate from`;
                    }
                    break;
                }

                case 'TAXONOMY_EXPANSION': {
                    // Add taxonomy entry via knowledge item
                    insert('fe_knowledge_items', {
                        source_type: 'taxonomy_expansion',
                        source_name: `proposal_${id}`,
                        signal_type: 'taxonomy',
                        key_insight: proposal.description,
                        action_implication: proposal.rationale,
                        urgency: 'medium',
                        is_processed: 1,
                        ingested_at: new Date().toISOString()
                    });
                    afterState = { added: proposal.description };
                    changeDescription = `Added taxonomy expansion: ${proposal.title}`;
                    break;
                }

                case 'SOURCE_ADDITION': {
                    // Add new knowledge source
                    const sourceId = insert('fe_knowledge_sources', {
                        source_name: proposal.title,
                        source_url: proposal.description,
                        source_type: 'auto_added',
                        crawl_frequency_hours: 6,
                        is_active: 1,
                        added_at: new Date().toISOString()
                    });
                    afterState = { source_id: sourceId, url: proposal.description };
                    changeDescription = `Added knowledge source: ${proposal.title} (source #${sourceId})`;
                    break;
                }

                case 'KNOWLEDGE_PURGE': {
                    // Deactivate a knowledge source
                    // Parse source identifier from description
                    const sourceMatch = (proposal.description || '').match(/source[_\s#]*(\d+)/i);
                    if (sourceMatch) {
                        const sourceId = parseInt(sourceMatch[1]);
                        const source = getOne('fe_knowledge_sources', sourceId);
                        if (source) {
                            update('fe_knowledge_sources', sourceId, { is_active: 0 });
                            afterState = { deactivated_source_id: sourceId, source_name: source.source_name };
                            changeDescription = `Deactivated knowledge source #${sourceId}: ${source.source_name}`;
                        } else {
                            changeDescription = `Knowledge purge: source #${sourceId} not found`;
                        }
                    } else {
                        // Deactivate sources matching the title pattern
                        const matchingSources = query(
                            `SELECT id, source_name FROM fe_knowledge_sources
                             WHERE is_active = 1 AND (source_name LIKE ? OR source_url LIKE ?)`,
                            [`%${proposal.title}%`, `%${proposal.title}%`]
                        );
                        for (const src of matchingSources) {
                            update('fe_knowledge_sources', src.id, { is_active: 0 });
                        }
                        afterState = { deactivated: matchingSources.length };
                        changeDescription = `Knowledge purge: deactivated ${matchingSources.length} sources matching "${proposal.title}"`;
                    }
                    break;
                }

                case 'NEW_SIGNAL':
                case 'RECOMMENDATION_IMPROVEMENT':
                case 'ARCHETYPE_SPLIT':
                case 'SCORING_FORMULA_UPDATE':
                default: {
                    // For types without direct DB mutations, log the change for manual follow-up
                    changeDescription = `Proposal applied (logged): [${proposal.proposal_type}] ${proposal.title} — ${proposal.description || 'no description'}`;
                    afterState = { logged: true, requires_manual_implementation: true };
                    break;
                }
            }

            // Mark proposal as applied
            const now = new Date().toISOString();
            update('fe_proposals', id, {
                status: 'applied',
                applied_at: now,
                rollback_available: 1
            });

            // Log to change_log
            const verificationAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
            insert('fe_change_log', {
                proposal_id: id,
                change_type: proposal.proposal_type,
                change_description: changeDescription,
                before_state_json: JSON.stringify(snapshotData),
                after_state_json: JSON.stringify(afterState),
                applied_at: now,
                verification_scheduled_at: verificationAt,
                was_rolled_back: 0
            });

            console.log(TAG, `Applied proposal #${id}: ${changeDescription}`);
            console.log(TAG, `Verification scheduled for ${verificationAt}`);
            return { applied: true, changeDescription, snapshotId, verificationAt };

        } catch (err) {
            console.error(TAG, `applyProposal error for #${id}:`, err.message);
            throw err;
        }
    }

    // ── 5. rollbackChange ──────────────────────────────────────────────────
    async function rollbackChange(proposalId) {
        try {
            console.log(TAG, `Rolling back changes from proposal #${proposalId}`);

            const proposal = getOne('fe_proposals', proposalId);
            if (!proposal) throw new Error(`Proposal #${proposalId} not found`);
            if (proposal.status !== 'applied') {
                throw new Error(`Proposal #${proposalId} is ${proposal.status}, cannot rollback`);
            }

            // Find snapshot
            const snapshots = query(
                `SELECT * FROM fe_rollback_snapshots WHERE proposal_id = ? ORDER BY id DESC LIMIT 1`,
                [proposalId]
            );
            if (snapshots.length === 0) {
                throw new Error(`No rollback snapshot found for proposal #${proposalId}`);
            }

            const snapshot = snapshots[0];
            const snapshotData = JSON.parse(snapshot.snapshot_data_json);

            // Restore state based on proposal type
            switch (proposal.proposal_type) {
                case 'WEIGHT_RECALIBRATION': {
                    if (snapshotData.current_weights_json) {
                        // Restore the previous weights by creating a new audit entry
                        insert('fe_audit_reports', {
                            audit_date: new Date().toISOString().split('T')[0],
                            meta_accuracy_pct: snapshotData.meta_accuracy_pct || null,
                            google_accuracy_pct: snapshotData.google_accuracy_pct || null,
                            current_weights_json: snapshotData.current_weights_json,
                            proposed_weights_json: null,
                            signal_analysis_json: JSON.stringify({ rollback_from_proposal: proposalId }),
                            proposals_generated: 0
                        });
                    }
                    break;
                }

                case 'TAXONOMY_EXPANSION': {
                    // Remove the added knowledge item
                    run(
                        `DELETE FROM fe_knowledge_items
                         WHERE source_type = 'taxonomy_expansion' AND source_name = ?`,
                        [`proposal_${proposalId}`]
                    );
                    break;
                }

                case 'SOURCE_ADDITION': {
                    // Deactivate the added source
                    if (snapshotData.source_count !== undefined) {
                        // Find sources added after the snapshot
                        run(
                            `UPDATE fe_knowledge_sources SET is_active = 0
                             WHERE source_type = 'auto_added' AND added_at >= ?`,
                            [proposal.applied_at || new Date().toISOString()]
                        );
                    }
                    break;
                }

                case 'KNOWLEDGE_PURGE': {
                    // Re-activate deactivated sources from snapshot
                    if (snapshotData.active_sources) {
                        for (const src of snapshotData.active_sources) {
                            update('fe_knowledge_sources', src.id, { is_active: 1 });
                        }
                    }
                    break;
                }

                default: {
                    console.log(TAG, `Rollback for ${proposal.proposal_type}: logged-only change, no automated restore`);
                    break;
                }
            }

            // Mark proposal
            update('fe_proposals', proposalId, {
                status: 'pending',
                applied_at: null,
                rollback_available: 0
            });

            // Update change_log
            const now = new Date().toISOString();
            run(
                `UPDATE fe_change_log SET was_rolled_back = 1, rolled_back_at = ?
                 WHERE proposal_id = ? AND was_rolled_back = 0`,
                [now, proposalId]
            );

            console.log(TAG, `Rolled back proposal #${proposalId} successfully`);
            return { rolledBack: true, proposalId };

        } catch (err) {
            console.error(TAG, `rollbackChange error for proposal #${proposalId}:`, err.message);
            throw err;
        }
    }

    // ── 6. getChangeLog ────────────────────────────────────────────────────
    async function getChangeLog() {
        try {
            const rows = query(
                `SELECT cl.*, p.title as proposal_title, p.proposal_type, p.risk_level
                 FROM fe_change_log cl
                 LEFT JOIN fe_proposals p ON p.id = cl.proposal_id
                 ORDER BY cl.applied_at DESC
                 LIMIT 200`
            );
            console.log(TAG, `getChangeLog: returned ${rows.length} entries`);
            return rows;
        } catch (err) {
            console.error(TAG, 'getChangeLog error:', err.message);
            throw err;
        }
    }

    // ── 7. verifyAppliedChanges ────────────────────────────────────────────
    async function verifyAppliedChanges() {
        const logId = logSchedulerStart('approval_engine_verify');
        try {
            const now = new Date().toISOString();

            // Find changes past their verification date that haven't been verified yet
            const pendingVerification = query(
                `SELECT cl.*, p.expected_impact_metric, p.expected_impact_delta, p.proposal_type
                 FROM fe_change_log cl
                 JOIN fe_proposals p ON p.id = cl.proposal_id
                 WHERE cl.verification_scheduled_at <= ?
                   AND cl.verification_result IS NULL
                   AND cl.was_rolled_back = 0
                   AND p.status = 'applied'
                 ORDER BY cl.verification_scheduled_at ASC`,
                [now]
            );

            console.log(TAG, `Found ${pendingVerification.length} changes needing verification`);

            let verified = 0;
            let rolledBack = 0;

            for (const change of pendingVerification) {
                try {
                    // Compute accuracy metrics before and after the change
                    const beforeState = change.before_state_json ? JSON.parse(change.before_state_json) : {};
                    const baselineAccuracy = beforeState.meta_accuracy_pct || beforeState.google_accuracy_pct || null;

                    // Get current accuracy from latest audit
                    const latestAudit = query(
                        `SELECT meta_accuracy_pct, google_accuracy_pct
                         FROM fe_audit_reports
                         ORDER BY id DESC LIMIT 1`
                    );

                    let currentAccuracy = null;
                    if (latestAudit.length > 0) {
                        currentAccuracy = latestAudit[0].meta_accuracy_pct || latestAudit[0].google_accuracy_pct;
                    }

                    // Also check prediction errors since apply
                    const recentErrors = query(
                        `SELECT AVG(ABS(error_d7)) as avg_abs_err
                         FROM fe_prediction_accuracy
                         WHERE created_at >= ?`,
                        [change.applied_at]
                    );
                    const avgErrorSinceApply = recentErrors.length > 0 ? recentErrors[0].avg_abs_err : null;

                    // Check if accuracy dropped >10% since apply
                    let verificationResult = 'passed';
                    let shouldRollback = false;

                    if (baselineAccuracy !== null && currentAccuracy !== null) {
                        const drop = baselineAccuracy - currentAccuracy;
                        if (drop > 10) {
                            verificationResult = 'failed_accuracy_drop';
                            shouldRollback = true;
                            console.warn(TAG, `Proposal #${change.proposal_id}: accuracy dropped ${drop.toFixed(1)}% — auto-rolling back`);
                        }
                    }

                    // If no accuracy data, check error trends
                    if (baselineAccuracy === null && avgErrorSinceApply !== null && avgErrorSinceApply > 0.5) {
                        // High average error is a red flag but not auto-rollback without baseline
                        verificationResult = 'warning_high_error';
                    }

                    // Update change_log with verification result
                    run(
                        `UPDATE fe_change_log SET verification_result = ? WHERE id = ?`,
                        [verificationResult, change.id]
                    );

                    verified++;

                    // Auto-rollback if accuracy dropped >10%
                    if (shouldRollback) {
                        try {
                            await rollbackChange(change.proposal_id);
                            rolledBack++;
                            console.log(TAG, `Auto-rolled back proposal #${change.proposal_id} due to accuracy drop`);
                        } catch (rollbackErr) {
                            console.error(TAG, `Auto-rollback failed for proposal #${change.proposal_id}:`, rollbackErr.message);
                        }
                    } else {
                        console.log(TAG, `Proposal #${change.proposal_id} verification: ${verificationResult}`);
                    }

                } catch (verifyErr) {
                    console.error(TAG, `Verification error for change #${change.id}:`, verifyErr.message);
                    run(
                        `UPDATE fe_change_log SET verification_result = ? WHERE id = ?`,
                        ['error: ' + verifyErr.message, change.id]
                    );
                }
            }

            logSchedulerEnd(logId, verified);
            console.log(TAG, `Verification complete: ${verified} verified, ${rolledBack} auto-rolled back`);
            return { verified, rolledBack, total: pendingVerification.length };

        } catch (err) {
            console.error(TAG, 'verifyAppliedChanges error:', err.message);
            logSchedulerEnd(logId, 0, err.message);
            throw err;
        }
    }

    // ── Internal: capture current state snapshot ───────────────────────────
    async function _captureSnapshot(proposal) {
        const snapshot = {
            captured_at: new Date().toISOString(),
            proposal_type: proposal.proposal_type
        };

        switch (proposal.proposal_type) {
            case 'WEIGHT_RECALIBRATION': {
                const audit = query(`SELECT * FROM fe_audit_reports ORDER BY id DESC LIMIT 1`);
                if (audit.length > 0) {
                    snapshot.current_weights_json = audit[0].current_weights_json;
                    snapshot.meta_accuracy_pct = audit[0].meta_accuracy_pct;
                    snapshot.google_accuracy_pct = audit[0].google_accuracy_pct;
                }
                break;
            }

            case 'TAXONOMY_EXPANSION': {
                const taxItems = query(
                    `SELECT COUNT(*) as cnt FROM fe_knowledge_items WHERE source_type = 'taxonomy_expansion'`
                );
                snapshot.taxonomy_count = taxItems[0].cnt;
                break;
            }

            case 'SOURCE_ADDITION': {
                const sources = query(
                    `SELECT COUNT(*) as cnt FROM fe_knowledge_sources WHERE is_active = 1`
                );
                snapshot.source_count = sources[0].cnt;
                break;
            }

            case 'KNOWLEDGE_PURGE': {
                const activeSources = getAll('fe_knowledge_sources', { is_active: 1 }, 'id ASC', 500);
                snapshot.active_sources = activeSources.map(s => ({ id: s.id, source_name: s.source_name, source_url: s.source_url }));
                break;
            }

            default: {
                // Generic snapshot: capture latest audit and anomaly state
                const audit = query(`SELECT * FROM fe_audit_reports ORDER BY id DESC LIMIT 1`);
                if (audit.length > 0) {
                    snapshot.meta_accuracy_pct = audit[0].meta_accuracy_pct;
                    snapshot.google_accuracy_pct = audit[0].google_accuracy_pct;
                }
                break;
            }
        }

        return snapshot;
    }

    return {
        approveProposal,
        rejectProposal,
        approveBatch,
        applyProposal,
        rollbackChange,
        getChangeLog,
        verifyAppliedChanges
    };
};
