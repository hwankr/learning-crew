# 픽셀 공부 공간 병합과 복원 기록

병합일: 2026-09-10 (KST). 작업 브랜치: `feat/pixel-study-room`.
개별 작업 커밋을 보존하는 병합 커밋으로 `main`에 합친다.

| 기준 | Git 참조 |
| --- | --- |
| 병합 전 `main` | `deb50881862206bc8a88a0a448de1a19378b341f` |
| 병합 전 백업 태그 | `backup/pre-pixel-study-room-2026-09-10` |
| 이번 병합 커밋 태그 | `merge/pixel-study-room-2026-09-10` |
| 마지막 기능 수정 커밋 | `ac2fad9dc86c834d853d1dea386c937b0ccff23a` |

두 태그는 원격 `origin`에 함께 보관한다. 커밋 해시를 기억해도 같은 코드를 찾을 수 있지만,
태그를 쓰면 기억하기 쉬운 이름으로 해당 커밋을 계속 가리킬 수 있다.
병합 태그의 첫 번째 부모는 위의 병합 전 `main` 커밋이다.

## 이번 기능을 되돌리기

로컬 수정이 없는 상태에서 실행한다. `revert`는 기존 이력을 유지하면서 이번 병합의 변경을
취소하는 새 커밋을 만든다. `-m 1`은 병합 전 `main`을 기준으로 되돌린다는 뜻이다.

```sh
git switch main
git pull --ff-only origin main
git fetch origin --tags
git revert --no-commit -m 1 merge/pixel-study-room-2026-09-10
git diff --cached --stat
npm test
npm run build
git commit -m "Revert pixel study room feature"
git push origin main
```

나중에 같은 파일을 수정한 작업이 있으면 충돌을 정리하고 검증한 뒤 커밋한다.
충돌 중 복원을 취소하려면 `git revert --abort`를 사용한다.
`main` 푸시 후에는 기존 GitHub Actions가 테스트·빌드·배포를 실행한다.

태그와 커밋은 소스 코드의 기준점이며 데이터베이스 백업과는 별개다.

## 이전 코드를 별도 폴더에서 확인하기

```sh
git fetch origin --tags
git worktree add --detach ../learningCrew-before-pixel backup/pre-pixel-study-room-2026-09-10
```

이 폴더에서 병합 전 코드를 확인할 수 있다. 사용 중인 `main`은 그대로 유지된다.
