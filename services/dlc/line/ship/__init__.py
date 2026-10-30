"""Ship: merge queue (block 15), dev QAS deploy (block 16), QAS runner + fixer (block 17).

  merge_queue.MergeQueue   FIFO by wave; rebase unit onto main; run acceptance; ff main
  deploy.Deployer          export main into qas/blue|green, smoke, switch qas/current
  qas_runner.QasRunner     acceptance + regression x N; green / red / flaky per F-item
  fixer.Fixer              red F-item -> fixer unit with evidence; generation cap -> escalate
"""
