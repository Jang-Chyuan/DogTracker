# Git 多人協作練習

專案分工：協作者 A 修改 `src/task1.cpp`（LED 心跳），協作者 B 修改 `src/task2.cpp`（序列埠狀態），`src/main.cpp` 由整合者維護。

## 1. 建立儲存庫

```bash
git init
git add .
git commit -m "chore: initialize multitask practice project"
git branch -M main
```

在 GitHub 建立空白 repository 後：

```bash
git remote add origin <repository-url>
git push -u origin main
```

## 2. 協作者取得與同步專案

```bash
git clone <repository-url>
cd GIT_test
git switch main
git pull --ff-only origin main
```

## 3. 建立各自的功能分支

協作者 A：

```bash
git switch -c feature/task1-led
```

協作者 B：

```bash
git switch -c feature/task2-status
```

修改完成後，以協作者 A 為例：

```bash
git status
git diff
git add src/task1.cpp
git commit -m "feat: improve task1 LED behavior"
git push -u origin feature/task1-led
```

協作者 B 將檔名與分支名換成 `task2`。

## 4. Pull Request 與合併

1. 從功能分支建立 Pull Request（PR）到 `main`。
2. 請另一位成員 review，確認 `pio run` 編譯成功。
3. 合併第一個 PR。
4. 第二位合併前同步最新 `main`：

```bash
git switch feature/task2-status
git fetch origin
git merge origin/main
git push
```

## 5. 練習衝突

兩人可在各自分支修改 `src/main.cpp` 同一行。第二位合併時：

```bash
git fetch origin
git merge origin/main
```

打開衝突檔，整合 `<<<<<<<`、`=======`、`>>>>>>>` 之間的內容並刪除標記：

```bash
git add src/main.cpp
git commit -m "merge: resolve main.cpp conflict"
git push
```

取消尚未完成的 merge：`git merge --abort`。

## 常用指令

```bash
git status
git branch --all
git log --oneline --graph --decorate --all
git diff
pio run
```

## 學習筆記

test：使用 `git status` 查看檔案狀態，使用 `git add` 將檔案加入暫存區，再用 `git commit` 建立版本紀錄。
增加一段學習筆記test