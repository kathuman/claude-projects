// Local persistence — one SQLite table, no server. Every method opens the
// (cached) database lazily so callers never have to think about init order.

import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

import 'problem.dart';

class ProblemDatabase {
  ProblemDatabase._();
  static final ProblemDatabase instance = ProblemDatabase._();

  Database? _db;

  Future<Database> get _database async => _db ??= await _open();

  Future<Database> _open() async {
    final dbPath = await getDatabasesPath();
    final path = p.join(dbPath, 'problemlog.db');
    return openDatabase(
      path,
      version: 1,
      onCreate: (db, version) => db.execute('''
        CREATE TABLE problems (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          summary TEXT NOT NULL,
          category TEXT NOT NULL,
          longTermSolution TEXT NOT NULL,
          shortTermMitigation TEXT NOT NULL,
          date TEXT NOT NULL
        )
      '''),
    );
  }

  Future<void> insert(Problem problem) async {
    final db = await _database;
    await db.insert(
      'problems',
      problem.toMap(),
      conflictAlgorithm: ConflictAlgorithm.replace,
    );
  }

  Future<void> update(Problem problem) => insert(problem);

  Future<void> delete(String id) async {
    final db = await _database;
    await db.delete('problems', where: 'id = ?', whereArgs: [id]);
  }

  Future<List<Problem>> all() async {
    final db = await _database;
    final rows = await db.query('problems', orderBy: 'date DESC');
    return rows.map(Problem.fromMap).toList();
  }

  Future<Problem?> byId(String id) async {
    final db = await _database;
    final rows = await db.query('problems', where: 'id = ?', whereArgs: [id]);
    if (rows.isEmpty) return null;
    return Problem.fromMap(rows.first);
  }
}
