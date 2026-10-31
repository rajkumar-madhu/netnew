// Collector jobs (service checks and application collectors) that the server
// stores and pushes to the agent of the node each job runs on.
import { JOB_TYPES, publicJob, validateJob } from '../services/jobs.js';
import { bad } from './helpers.js';

export function registerJobRoutes(api, { core, db, withScope, nodeNames }) {
  api.get('/job-types', (req, res) => res.json(JOB_TYPES));

  api.get('/jobs', withScope((req, res, ids) => {
    const set = new Set(ids);
    const names = nodeNames();
    res.json(db.listJobs().filter((j) => set.has(j.node_id))
      .map((j) => ({ ...publicJob(j, core.jobStatus.get(j.id)), hostname: names[j.node_id] })));
  }));

  api.post('/jobs', (req, res) => {
    const { job, error } = validateJob(req.body);
    if (error) return bad(res, error);
    if (!db.getNode(job.node_id)) return bad(res, 'node not found', 404);
    const row = db.createJob(job, core.now());
    core.pushJobs(row.node_id);
    res.status(201).json(publicJob(row));
  });

  api.patch('/jobs/:id', (req, res) => {
    const existing = db.getJob(Number(req.params.id));
    if (!existing) return bad(res, 'job not found', 404);
    const { job, error } = validateJob(req.body, existing);
    if (error) return bad(res, error);
    const row = db.updateJob(existing.id, job, core.now());
    core.pushJobs(row.node_id);
    if (!row.enabled) core.clearJob(row);
    res.json(publicJob(row, core.jobStatus.get(row.id)));
  });

  api.delete('/jobs/:id', (req, res) => {
    const existing = db.getJob(Number(req.params.id));
    if (!existing) return bad(res, 'job not found', 404);
    db.deleteJob(existing.id);
    core.pushJobs(existing.node_id);
    core.clearJob(existing);
    res.status(204).end();
  });
}
