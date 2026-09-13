"""
Graphical two-player chess game using tkinter.

Run with:  python chess_game.py

Click a piece to select it (legal destinations are highlighted), then click
a highlighted square to move there. Supports castling, en passant, pawn
promotion, check/checkmate/stalemate detection, undo, and new game.
"""

import copy
import tkinter as tk
from tkinter import font as tkfont

# ---------------------------------------------------------------------------
# Board / rules engine
# ---------------------------------------------------------------------------

def in_bounds(r, c):
    return 0 <= r < 8 and 0 <= c < 8


def color_of(piece):
    if piece is None:
        return None
    return 'w' if piece.isupper() else 'b'


def opponent(color):
    return 'b' if color == 'w' else 'w'


def initial_board():
    # row 0 = rank 8 (black back rank), row 7 = rank 1 (white back rank)
    board = [[None] * 8 for _ in range(8)]
    back_rank = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R']
    for c in range(8):
        board[0][c] = back_rank[c].lower()
        board[1][c] = 'p'
        board[6][c] = 'P'
        board[7][c] = back_rank[c]
    return board


KNIGHT_DELTAS = [(-2, -1), (-2, 1), (-1, -2), (-1, 2), (1, -2), (1, 2), (2, -1), (2, 1)]
DIAG_DIRS = [(-1, -1), (-1, 1), (1, -1), (1, 1)]
STRAIGHT_DIRS = [(-1, 0), (1, 0), (0, -1), (0, 1)]


class ChessGame:
    def __init__(self):
        self.board = initial_board()
        self.turn = 'w'
        self.castling = {'K': True, 'Q': True, 'k': True, 'q': True}
        self.en_passant = None  # square that can currently be captured en passant
        self.history = []       # for undo: (board, turn, castling, en_passant, last_move)
        self.last_move = None

    # -- attack / check detection -----------------------------------------

    def king_pos(self, board, color):
        target = 'K' if color == 'w' else 'k'
        for r in range(8):
            for c in range(8):
                if board[r][c] == target:
                    return (r, c)
        return None

    def attacked_by(self, board, r, c, by_color):
        knight_piece = 'N' if by_color == 'w' else 'n'
        for dr, dc in KNIGHT_DELTAS:
            rr, cc = r + dr, c + dc
            if in_bounds(rr, cc) and board[rr][cc] == knight_piece:
                return True

        king_piece = 'K' if by_color == 'w' else 'k'
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                if dr == 0 and dc == 0:
                    continue
                rr, cc = r + dr, c + dc
                if in_bounds(rr, cc) and board[rr][cc] == king_piece:
                    return True

        pawn_piece = 'P' if by_color == 'w' else 'p'
        pawn_dr = 1 if by_color == 'w' else -1
        for dc in (-1, 1):
            rr, cc = r + pawn_dr, c + dc
            if in_bounds(rr, cc) and board[rr][cc] == pawn_piece:
                return True

        bishop_like = ('B', 'Q') if by_color == 'w' else ('b', 'q')
        for dr, dc in DIAG_DIRS:
            rr, cc = r + dr, c + dc
            while in_bounds(rr, cc):
                p = board[rr][cc]
                if p is not None:
                    if p in bishop_like:
                        return True
                    break
                rr += dr
                cc += dc

        rook_like = ('R', 'Q') if by_color == 'w' else ('r', 'q')
        for dr, dc in STRAIGHT_DIRS:
            rr, cc = r + dr, c + dc
            while in_bounds(rr, cc):
                p = board[rr][cc]
                if p is not None:
                    if p in rook_like:
                        return True
                    break
                rr += dr
                cc += dc

        return False

    # -- move generation -----------------------------------------------------
    # A move tuple is: (from_r, from_c, to_r, to_c, flag, extra)
    # flag in {None, 'double', 'ep', 'promo', 'O-O', 'O-O-O'}

    def pseudo_moves_for(self, board, r, c, castling, en_passant):
        piece = board[r][c]
        if piece is None:
            return []
        color = color_of(piece)
        ptype = piece.upper()
        moves = []

        if ptype == 'P':
            dr = -1 if color == 'w' else 1
            start_row = 6 if color == 'w' else 1
            promo_row = 0 if color == 'w' else 7

            rr, cc = r + dr, c
            if in_bounds(rr, cc) and board[rr][cc] is None:
                if rr == promo_row:
                    for promo in ('Q', 'R', 'B', 'N'):
                        moves.append((r, c, rr, cc, 'promo', promo))
                else:
                    moves.append((r, c, rr, cc, None, None))
                if r == start_row:
                    rr2 = r + 2 * dr
                    if board[rr2][cc] is None:
                        moves.append((r, c, rr2, cc, 'double', None))

            for dc in (-1, 1):
                rr, cc = r + dr, c + dc
                if in_bounds(rr, cc):
                    target = board[rr][cc]
                    if target is not None and color_of(target) != color:
                        if rr == promo_row:
                            for promo in ('Q', 'R', 'B', 'N'):
                                moves.append((r, c, rr, cc, 'promo', promo))
                        else:
                            moves.append((r, c, rr, cc, None, None))
                    elif en_passant == (rr, cc):
                        moves.append((r, c, rr, cc, 'ep', None))

        elif ptype == 'N':
            for dr, dc in KNIGHT_DELTAS:
                rr, cc = r + dr, c + dc
                if in_bounds(rr, cc):
                    target = board[rr][cc]
                    if target is None or color_of(target) != color:
                        moves.append((r, c, rr, cc, None, None))

        elif ptype in ('B', 'R', 'Q'):
            dirs = []
            if ptype in ('B', 'Q'):
                dirs += DIAG_DIRS
            if ptype in ('R', 'Q'):
                dirs += STRAIGHT_DIRS
            for dr, dc in dirs:
                rr, cc = r + dr, c + dc
                while in_bounds(rr, cc):
                    target = board[rr][cc]
                    if target is None:
                        moves.append((r, c, rr, cc, None, None))
                    else:
                        if color_of(target) != color:
                            moves.append((r, c, rr, cc, None, None))
                        break
                    rr += dr
                    cc += dc

        elif ptype == 'K':
            for dr in (-1, 0, 1):
                for dc in (-1, 0, 1):
                    if dr == 0 and dc == 0:
                        continue
                    rr, cc = r + dr, c + dc
                    if in_bounds(rr, cc):
                        target = board[rr][cc]
                        if target is None or color_of(target) != color:
                            moves.append((r, c, rr, cc, None, None))

            row = 7 if color == 'w' else 0
            if r == row and c == 4:
                kside = 'K' if color == 'w' else 'k'
                qside = 'Q' if color == 'w' else 'q'
                rook = 'R' if color == 'w' else 'r'
                opp = opponent(color)
                if (castling.get(kside) and board[row][5] is None and board[row][6] is None
                        and board[row][7] == rook):
                    if not (self.attacked_by(board, row, 4, opp)
                            or self.attacked_by(board, row, 5, opp)
                            or self.attacked_by(board, row, 6, opp)):
                        moves.append((r, c, row, 6, 'O-O', None))
                if (castling.get(qside) and board[row][1] is None and board[row][2] is None
                        and board[row][3] is None and board[row][0] == rook):
                    if not (self.attacked_by(board, row, 4, opp)
                            or self.attacked_by(board, row, 3, opp)
                            or self.attacked_by(board, row, 2, opp)):
                        moves.append((r, c, row, 2, 'O-O-O', None))

        return moves

    def apply_move_to(self, board, move, castling):
        r, c, rr, cc, flag, extra = move
        piece = board[r][c]
        color = color_of(piece)

        if piece.upper() == 'K':
            if color == 'w':
                castling['K'] = False
                castling['Q'] = False
            else:
                castling['k'] = False
                castling['q'] = False
        if piece.upper() == 'R':
            if (r, c) == (7, 0):
                castling['Q'] = False
            elif (r, c) == (7, 7):
                castling['K'] = False
            elif (r, c) == (0, 0):
                castling['q'] = False
            elif (r, c) == (0, 7):
                castling['k'] = False

        captured = board[rr][cc]
        if captured and captured.upper() == 'R':
            if (rr, cc) == (7, 0):
                castling['Q'] = False
            elif (rr, cc) == (7, 7):
                castling['K'] = False
            elif (rr, cc) == (0, 0):
                castling['q'] = False
            elif (rr, cc) == (0, 7):
                castling['k'] = False

        board[r][c] = None
        if flag == 'ep':
            board[r][cc] = None
            board[rr][cc] = piece
        elif flag == 'promo':
            board[rr][cc] = extra if color == 'w' else extra.lower()
        else:
            board[rr][cc] = piece

        if flag == 'O-O':
            board[r][5] = board[r][7]
            board[r][7] = None
        elif flag == 'O-O-O':
            board[r][3] = board[r][0]
            board[r][0] = None

    def generate_legal_moves(self, color):
        legal = []
        for r in range(8):
            for c in range(8):
                p = self.board[r][c]
                if p and color_of(p) == color:
                    for mv in self.pseudo_moves_for(self.board, r, c, self.castling, self.en_passant):
                        b2 = copy.deepcopy(self.board)
                        cast2 = dict(self.castling)
                        self.apply_move_to(b2, mv, cast2)
                        kp = self.king_pos(b2, color)
                        if kp and not self.attacked_by(b2, kp[0], kp[1], opponent(color)):
                            legal.append(mv)
        return legal

    def in_check(self, color):
        kp = self.king_pos(self.board, color)
        return kp is not None and self.attacked_by(self.board, kp[0], kp[1], opponent(color))

    def make_move(self, move):
        self.history.append((copy.deepcopy(self.board), self.turn, dict(self.castling),
                              self.en_passant, self.last_move))
        r, c, rr, cc, flag, extra = move
        self.apply_move_to(self.board, move, self.castling)
        self.en_passant = ((r + rr) // 2, c) if flag == 'double' else None
        self.last_move = (r, c, rr, cc)
        self.turn = opponent(self.turn)

    def undo(self):
        if not self.history:
            return False
        self.board, self.turn, self.castling, self.en_passant, self.last_move = self.history.pop()
        return True


# ---------------------------------------------------------------------------
# GUI
# ---------------------------------------------------------------------------

SQUARE = 80
BOARD_PX = SQUARE * 8

LIGHT = "#f0d9b5"
DARK = "#b58863"
SELECT_COLOR = "#f6f669"
LASTMOVE_COLOR = "#cdd26a"
CHECK_COLOR = "#e8695f"
DOT_COLOR = "#4a4a4a"

ANIMATION_MS = 160     # total duration of a move animation
ANIMATION_STEPS = 12   # number of frames used to animate a move

UNICODE_PIECES = {
    'K': '♔', 'Q': '♕', 'R': '♖', 'B': '♗', 'N': '♘', 'P': '♙',
    'k': '♚', 'q': '♛', 'r': '♜', 'b': '♝', 'n': '♞', 'p': '♟',
}


class ChessApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Chess")
        self.root.resizable(False, False)

        self.game = ChessGame()
        self.selected = None       # (r, c) of selected piece
        self.legal_targets = []    # legal moves originating from selected square
        self.legal_moves_cache = self.game.generate_legal_moves(self.game.turn)
        self.game_over = False
        self.animating = False
        self.anim_token = 0

        piece_families = tkfont.families()
        family = "Segoe UI Symbol" if "Segoe UI Symbol" in piece_families else "Arial"
        self.piece_font = tkfont.Font(family=family, size=int(SQUARE * 0.58))
        self.coord_font = tkfont.Font(family="Arial", size=10)

        self.status = tk.Label(root, text="", font=("Arial", 14), pady=8)
        self.status.pack(fill="x")

        self.canvas = tk.Canvas(root, width=BOARD_PX, height=BOARD_PX, highlightthickness=0)
        self.canvas.pack()
        self.canvas.bind("<Button-1>", self.on_click)

        btn_frame = tk.Frame(root, pady=8)
        btn_frame.pack()
        tk.Button(btn_frame, text="New Game", command=self.new_game).pack(side="left", padx=6)
        tk.Button(btn_frame, text="Undo", command=self.undo).pack(side="left", padx=6)

        self.draw()

    def new_game(self):
        self.anim_token += 1
        self.animating = False
        self.game = ChessGame()
        self.selected = None
        self.legal_targets = []
        self.legal_moves_cache = self.game.generate_legal_moves(self.game.turn)
        self.game_over = False
        self.draw()

    def undo(self):
        self.anim_token += 1
        self.animating = False
        if self.game_over:
            self.game_over = False
        if self.game.undo():
            self.selected = None
            self.legal_targets = []
            self.legal_moves_cache = self.game.generate_legal_moves(self.game.turn)
            self.draw()

    def square_colors(self, r, c):
        return LIGHT if (r + c) % 2 == 0 else DARK

    def draw_board_layer(self, board, highlights=None, exclude=None):
        """Draw squares (optionally tinted per-square) and pieces from `board`,
        skipping squares listed in `exclude` (used to hide pieces mid-animation)."""
        highlights = highlights or {}
        exclude = exclude or set()
        self.canvas.delete("all")
        for r in range(8):
            for c in range(8):
                x0, y0 = c * SQUARE, r * SQUARE
                x1, y1 = x0 + SQUARE, y0 + SQUARE
                color = highlights.get((r, c), self.square_colors(r, c))

                self.canvas.create_rectangle(x0, y0, x1, y1, fill=color, outline="")

                if c == 0:
                    self.canvas.create_text(x0 + 4, y0 + 4, text=str(8 - r), anchor="nw",
                                             font=self.coord_font,
                                             fill=DARK if color == LIGHT else LIGHT)
                if r == 7:
                    self.canvas.create_text(x1 - 4, y1 - 4, text="abcdefgh"[c], anchor="se",
                                             font=self.coord_font,
                                             fill=DARK if color == LIGHT else LIGHT)

                if (r, c) in exclude:
                    continue
                piece = board[r][c]
                if piece:
                    self.canvas.create_text(x0 + SQUARE / 2, y0 + SQUARE / 2,
                                             text=UNICODE_PIECES[piece], font=self.piece_font)

    def draw(self):
        game = self.game

        highlights = {}
        if game.last_move:
            lr, lc, ltr, ltc = game.last_move
            highlights[(lr, lc)] = LASTMOVE_COLOR
            highlights[(ltr, ltc)] = LASTMOVE_COLOR
        if self.selected:
            highlights[self.selected] = SELECT_COLOR
        if game.in_check(game.turn):
            highlights[game.king_pos(game.board, game.turn)] = CHECK_COLOR

        self.draw_board_layer(game.board, highlights)

        for mv in self.legal_targets:
            _, _, rr, cc, flag, _ = mv
            cx, cy = cc * SQUARE + SQUARE / 2, rr * SQUARE + SQUARE / 2
            if game.board[rr][cc] is not None or flag == 'ep':
                self.canvas.create_oval(cx - SQUARE * 0.42, cy - SQUARE * 0.42,
                                         cx + SQUARE * 0.42, cy + SQUARE * 0.42,
                                         outline=DOT_COLOR, width=4)
            else:
                r_dot = SQUARE * 0.14
                self.canvas.create_oval(cx - r_dot, cy - r_dot, cx + r_dot, cy + r_dot,
                                         fill=DOT_COLOR, outline="")

        self.update_status()

    def update_status(self):
        game = self.game
        turn_name = "White" if game.turn == 'w' else "Black"

        if self.game_over:
            return

        if not self.legal_moves_cache:
            if game.in_check(game.turn):
                winner = "Black" if game.turn == 'w' else "White"
                self.status.config(text=f"Checkmate! {winner} wins.")
            else:
                self.status.config(text="Stalemate! Draw.")
            self.game_over = True
            return

        if game.in_check(game.turn):
            self.status.config(text=f"{turn_name} to move — Check!")
        else:
            self.status.config(text=f"{turn_name} to move")

    def ask_promotion(self, color):
        result = {"choice": "Q"}
        dialog = tk.Toplevel(self.root)
        dialog.title("Promote pawn")
        dialog.resizable(False, False)
        dialog.transient(self.root)
        dialog.grab_set()

        tk.Label(dialog, text="Choose promotion:", font=("Arial", 12)).pack(padx=12, pady=8)
        row = tk.Frame(dialog)
        row.pack(padx=12, pady=8)

        def choose(piece):
            result["choice"] = piece
            dialog.destroy()

        for piece in ('Q', 'R', 'B', 'N'):
            glyph = UNICODE_PIECES[piece if color == 'w' else piece.lower()]
            tk.Button(row, text=glyph, font=self.piece_font, width=2,
                      command=lambda p=piece: choose(p)).pack(side="left", padx=4)

        dialog.protocol("WM_DELETE_WINDOW", lambda: choose("Q"))
        self.root.wait_window(dialog)
        return result["choice"]

    def animate_move(self, move, pre_board):
        """Slide the moved piece (and rook, on castling) from its origin to its
        destination over a few frames, using `pre_board` as the pre-move snapshot
        to render underneath. `self.game` has already been updated by the caller."""
        r, c, rr, cc, flag, _ = move

        movers = [(pre_board[r][c], r, c, rr, cc)]
        if flag == 'O-O':
            movers.append((pre_board[r][7], r, 7, r, 5))
        elif flag == 'O-O-O':
            movers.append((pre_board[r][0], r, 0, r, 3))

        hidden = set()
        for _, fr, fc, tr, tc in movers:
            hidden.add((fr, fc))
            hidden.add((tr, tc))
        if flag == 'ep':
            hidden.add((r, cc))  # the captured pawn, removed from its square

        self.animating = True
        self.anim_token += 1
        token = self.anim_token
        frame_delay = max(1, ANIMATION_MS // ANIMATION_STEPS)

        def step(i):
            if token != self.anim_token:
                return  # a newer move/undo/reset superseded this animation
            t = i / ANIMATION_STEPS
            t = 1 - (1 - t) ** 2  # ease-out
            self.draw_board_layer(pre_board, exclude=hidden)
            for piece, fr, fc, tr, tc in movers:
                x = (fc + (tc - fc) * t) * SQUARE + SQUARE / 2
                y = (fr + (tr - fr) * t) * SQUARE + SQUARE / 2
                self.canvas.create_text(x, y, text=UNICODE_PIECES[piece], font=self.piece_font)
            if i < ANIMATION_STEPS:
                self.root.after(frame_delay, lambda: step(i + 1))
            else:
                self.animating = False
                self.draw()

        step(0)

    def on_click(self, event):
        if self.game_over or self.animating:
            return
        col = event.x // SQUARE
        row = event.y // SQUARE
        if not in_bounds(row, col):
            return

        game = self.game
        board = game.board

        if self.selected is None:
            piece = board[row][col]
            if piece and color_of(piece) == game.turn:
                self.selected = (row, col)
                self.legal_targets = [m for m in self.legal_moves_cache
                                       if m[0] == row and m[1] == col]
            self.draw()
            return

        matching = [m for m in self.legal_targets if m[2] == row and m[3] == col]
        if matching:
            move = matching[0]
            if move[4] == 'promo':
                choice = self.ask_promotion(game.turn)
                for m in matching:
                    if m[5] == choice:
                        move = m
                        break
            pre_board = copy.deepcopy(game.board)
            game.make_move(move)
            self.selected = None
            self.legal_targets = []
            self.legal_moves_cache = game.generate_legal_moves(game.turn)
            self.animate_move(move, pre_board)
            return

        piece = board[row][col]
        if piece and color_of(piece) == game.turn:
            self.selected = (row, col)
            self.legal_targets = [m for m in self.legal_moves_cache
                                   if m[0] == row and m[1] == col]
        else:
            self.selected = None
            self.legal_targets = []
        self.draw()


def main():
    root = tk.Tk()
    ChessApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
