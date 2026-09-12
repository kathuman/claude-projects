// A single logged problem: the raw description the user gave (typed or
// dictated) plus the structured fields Claude derived from it.

class Problem {
  final String id; // problemID
  final String title;
  final String description; // raw, as told by the user
  final String summary; // "summarized description"
  final String category;
  final String longTermSolution;
  final String shortTermMitigation;
  final DateTime date;

  const Problem({
    required this.id,
    required this.title,
    required this.description,
    required this.summary,
    required this.category,
    required this.longTermSolution,
    required this.shortTermMitigation,
    required this.date,
  });

  Problem copyWith({
    String? title,
    String? description,
    String? summary,
    String? category,
    String? longTermSolution,
    String? shortTermMitigation,
  }) {
    return Problem(
      id: id,
      title: title ?? this.title,
      description: description ?? this.description,
      summary: summary ?? this.summary,
      category: category ?? this.category,
      longTermSolution: longTermSolution ?? this.longTermSolution,
      shortTermMitigation: shortTermMitigation ?? this.shortTermMitigation,
      date: date,
    );
  }

  Map<String, Object?> toMap() => {
        'id': id,
        'title': title,
        'description': description,
        'summary': summary,
        'category': category,
        'longTermSolution': longTermSolution,
        'shortTermMitigation': shortTermMitigation,
        'date': date.toIso8601String(),
      };

  factory Problem.fromMap(Map<String, Object?> map) => Problem(
        id: map['id'] as String,
        title: map['title'] as String,
        description: map['description'] as String,
        summary: map['summary'] as String,
        category: map['category'] as String,
        longTermSolution: map['longTermSolution'] as String,
        shortTermMitigation: map['shortTermMitigation'] as String,
        date: DateTime.parse(map['date'] as String),
      );
}

/// The structured fields Claude derives from a raw description — everything
/// in [Problem] except the id/date/raw description, which the app itself
/// owns.
class ProblemAnalysis {
  final String title;
  final String summary;
  final String category;
  final String longTermSolution;
  final String shortTermMitigation;

  const ProblemAnalysis({
    required this.title,
    required this.summary,
    required this.category,
    required this.longTermSolution,
    required this.shortTermMitigation,
  });
}
