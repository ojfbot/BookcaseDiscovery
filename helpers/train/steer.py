"""TS-2 catalog steering (evals/TS2/prereg.md): a logits processor that nudges greedy decoding towards candidate
targets while the output is still a token prefix of one, and leaves it free once it has left them all.

Pure apart from the logits array: the prefix logic is plain Python, so it is checked without a model
(`python steer.py --self-test`). Used only by read_student.py; F-0's readers never load it.
"""

from __future__ import annotations

import sys
from typing import Callable, Sequence


class Steer:
    """Additive bias on each live candidate's next token (and the end tokens once a candidate is complete)."""

    def __init__(self, candidates: Sequence[Sequence[int]], bias: float, end_ids: Sequence[int], prompt_len: int | None = None) -> None:
        self.cands = [list(c) for c in candidates if len(c) > 0]
        self.bias = float(bias)
        self.end_ids = list(end_ids)
        # mlx-vlm hands each processor the prompt's ids plus the tokens generated so far; its first call comes right
        # after the prefill, so the history's length then is the prompt's.
        self.prompt_len = prompt_len
        self.hits = 0  # steps at which a bias was applied

    def next_ids(self, generated: Sequence[int]) -> list[int]:
        """Token ids to boost after `generated`: each live candidate's next token, or the end tokens for a finished one."""
        n = len(generated)
        out: set[int] = set()
        for c in self.cands:
            if len(c) < n or list(c[:n]) != list(generated):
                continue
            if len(c) == n:
                out.update(self.end_ids)
            else:
                out.add(c[n])
        return sorted(out)

    def processor(self) -> Callable:
        """The mlx-vlm logits processor: (tokens so far, prompt included; logits [1, vocab]) -> logits."""
        import mlx.core as mx

        def proc(tokens, logits):
            history = tokens.tolist() if tokens is not None else []
            if self.prompt_len is None:
                self.prompt_len = len(history)
            generated = history[self.prompt_len:]
            ids = self.next_ids(generated)
            if not ids:
                return logits
            self.hits += 1
            add = mx.zeros((logits.shape[-1],), dtype=logits.dtype)
            add[mx.array(ids)] = self.bias
            return logits + add

        return proc


def self_test() -> None:
    s = Steer([[5, 6, 7], [5, 9]], 2.0, [0], prompt_len=0)
    assert s.next_ids([]) == [5]
    assert s.next_ids([5]) == [6, 9]
    assert s.next_ids([5, 6]) == [7]
    assert s.next_ids([5, 6, 7]) == [0]  # complete: boost the end token
    assert s.next_ids([5, 8]) == []  # left every candidate: free decoding
    assert s.next_ids([5, 6, 7, 1]) == []
    assert Steer([], 2.0, [0], 0).next_ids([]) == []
    print("steer: self-test ok", file=sys.stderr)


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        self_test()
