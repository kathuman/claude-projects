import 'package:flutter/material.dart';

import 'ui/home_screen.dart';

void main() => runApp(const ProblemLogApp());

const _seed = Color(0xFF2B4C6F);

class ProblemLogApp extends StatelessWidget {
  const ProblemLogApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Problem Log',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(colorScheme: ColorScheme.fromSeed(seedColor: _seed), useMaterial3: true),
      darkTheme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: _seed, brightness: Brightness.dark),
        useMaterial3: true,
      ),
      home: const HomeScreen(),
    );
  }
}
