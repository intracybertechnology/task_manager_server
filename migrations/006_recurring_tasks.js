// Recurring tasks: templates, who they apply to, and the extra columns on tasks
// that let a generated task point back to its template.
//
// Task status becomes a STRING so 'MISSED' can be added later without altering
// a Postgres enum on a live table (the model still restricts the allowed values).

const name = '006_recurring_tasks';

const hasTable = async (qi, t) =>
  (await qi.showAllTables()).map((x) => (typeof x === 'string' ? x : x.tableName)).includes(t);

const up = async (queryInterface, DataTypes) => {
  const sql = queryInterface.sequelize;

  // ── task_templates ────────────────────────────────────────────────────────
  if (!(await hasTable(queryInterface, 'task_templates'))) {
    await queryInterface.createTable('task_templates', {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
      title: { type: DataTypes.STRING(255), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
      department_id: { type: DataTypes.UUID, allowNull: true },
      project_id: { type: DataTypes.UUID, allowNull: true },
      frequency: { type: DataTypes.ENUM('DAILY', 'WEEKLY', 'MONTHLY'), allowNull: false },
      // Days of the week for WEEKLY: 0 = Sunday … 6 = Saturday. Empty for DAILY/MONTHLY.
      weekdays: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
      // Day of the month for MONTHLY (1–31; 31 means "last day" of shorter months).
      day_of_month: { type: DataTypes.INTEGER, allowNull: true },
      start_time: { type: DataTypes.STRING(5), allowNull: false },
      duration_minutes: { type: DataTypes.INTEGER, allowNull: false },
      priority: { type: DataTypes.ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT'), allowNull: false, defaultValue: 'MEDIUM' },
      // When resolving people: 'DEPARTMENT' uses everyone in department_id,
      // 'PEOPLE' uses only the template_members rows with mode ADD.
      assignee_mode: { type: DataTypes.ENUM('DEPARTMENT', 'PEOPLE'), allowNull: false, defaultValue: 'DEPARTMENT' },
      is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      created_by: { type: DataTypes.UUID, allowNull: false },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    });
    console.log('  created task_templates');
  }

  // ── template_members ──────────────────────────────────────────────────────
  if (!(await hasTable(queryInterface, 'template_members'))) {
    await queryInterface.createTable('template_members', {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
      template_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'task_templates', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      employee_id: { type: DataTypes.UUID, allowNull: false },
      mode: { type: DataTypes.ENUM('ADD', 'EXCLUDE'), allowNull: false, defaultValue: 'ADD' },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    });
    await sql.query(
      'CREATE UNIQUE INDEX template_members_unique ON template_members (template_id, employee_id)'
    );
    console.log('  created template_members');
  }

  // ── tasks: extra columns ──────────────────────────────────────────────────
  const cols = await queryInterface.describeTable('tasks');

  const addIfMissing = async (column, spec) => {
    if (cols[column]) return;
    await queryInterface.addColumn('tasks', column, spec);
    console.log(`  added tasks.${column}`);
  };

  await addIfMissing('task_date', { type: DataTypes.DATEONLY, allowNull: true });
  await addIfMissing('start_time', { type: DataTypes.STRING(5), allowNull: true });
  await addIfMissing('end_time', { type: DataTypes.STRING(5), allowNull: true });
  await addIfMissing('task_type', {
    type: DataTypes.ENUM('ONE_OFF', 'RECURRING', 'ADDITIONAL'),
    allowNull: false,
    defaultValue: 'ONE_OFF',
  });
  await addIfMissing('template_id', { type: DataTypes.UUID, allowNull: true });
  await addIfMissing('auto_generated', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
  await addIfMissing('time_edited', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });

  // ── task status: enum -> string, so 'MISSED' needs no enum migration later ──
  const statusType = await sql.query(
    `SELECT data_type FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'status'`,
    { type: sql.QueryTypes.SELECT }
  );
  if (statusType.length === 0) {
    await queryInterface.addColumn('tasks', 'status', {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: 'TODO',
    });
    console.log('  added tasks.status');
  } else if (statusType[0].data_type === 'USER-DEFINED') {
    await sql.query('ALTER TABLE tasks ALTER COLUMN status DROP DEFAULT');
    await sql.query('ALTER TABLE tasks ALTER COLUMN status TYPE VARCHAR(16) USING status::text');
    await sql.query("ALTER TABLE tasks ALTER COLUMN status SET DEFAULT 'TODO'");
    console.log('  converted tasks.status enum -> string');
  }

  // ── Safety net: a template can only produce ONE task per date ─────────────
  const idx = await sql.query(
    `SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'tasks_template_date_unique'`,
    { type: sql.QueryTypes.SELECT }
  );
  if (idx.length === 0) {
    await sql.query(
      `CREATE UNIQUE INDEX tasks_template_date_unique ON tasks (template_id, task_date) WHERE template_id IS NOT NULL`
    );
    console.log('  created tasks_template_date_unique');
  }

  const tIdx = await sql.query(
    `SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'tasks_task_date_idx'`,
    { type: sql.QueryTypes.SELECT }
  );
  if (tIdx.length === 0) {
    await sql.query('CREATE INDEX tasks_task_date_idx ON tasks (task_date)');
    console.log('  created tasks_task_date_idx');
  }
};

module.exports = { name, up };
