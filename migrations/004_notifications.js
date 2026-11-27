// Saved notifications. Each row is written first, then pushed live over a socket,
// so a notification survives reloads, logouts and a socket being offline.

const name = '004_notifications';

const up = async (queryInterface, DataTypes) => {
  const tables = (await queryInterface.showAllTables()).map((t) =>
    typeof t === 'string' ? t : t.tableName
  );
  if (!tables.includes('notifications')) {
    await queryInterface.createTable('notifications', {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true, allowNull: false },
      user_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      type: { type: DataTypes.STRING(48), allowNull: false },
      title: { type: DataTypes.STRING(160), allowNull: false },
      body: { type: DataTypes.STRING(500), allowNull: true },
      link: { type: DataTypes.STRING(200), allowNull: true },
      is_read: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      read_at: { type: DataTypes.DATE, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    });
    console.log('  created notifications table');
  }

  const sql = queryInterface.sequelize;
  const idx = await sql.query(
    `SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'notifications_user_unread_idx'`,
    { type: sql.QueryTypes.SELECT }
  );
  if (idx.length === 0) {
    await sql.query(
      'CREATE INDEX notifications_user_unread_idx ON notifications (user_id, is_read, "createdAt")'
    );
    console.log('  created notifications_user_unread_idx');
  }
};

module.exports = { name, up };
