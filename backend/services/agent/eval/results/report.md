# PDF RAG Eval Report

Generated: 2026-08-12T18:26:48.618Z

## Summary

- Total questions: 21 (18 factual, 3 adversarial)
- Retrieval hit rate (factual questions only, top-5): **18/18 (100%)**
- Answer correctness: **21/21 (100%) PASS**, 0/21 FAIL, 0/21 AMBIGUOUS (needs manual grading)

## Results

| ID | Doc | Type | Question | Expected | Actual (truncated) | Retrieval | Correctness | Note |
|----|-----|------|----------|----------|---------------------|-----------|--------------|------|
| cortex-1 | cortex-handbook.pdf | factual | How many credits does the search agent cost per request? | 5 credits | ### Credit Cost for Search Agent The search agent costs **5 credits** per request. | HIT | PASS |  |
| cortex-2 | cortex-handbook.pdf | factual | How many requests per minute is the coding agent allowed? | 5 requests per minute | ### Answer The coding agent is allowed **5 requests per minute**. | HIT | PASS |  |
| cortex-3 | cortex-handbook.pdf | factual | How long does the download link for a generated file stay valid? | 24 hours | ### Answer The download link for a generated file stays valid for **24 hours**. | HIT | PASS |  |
| cortex-4 | cortex-handbook.pdf | factual | What happens to the vector collection built from an uploaded PDF after the answer is generated? | It is deleted immediately after the answer is generated. | ### Answer The vector collection built from an uploaded PDF is **deleted immediately** after the answer is generated, so no persistent index of an uploaded docu | HIT | PASS |  |
| cortex-5 | cortex-handbook.pdf | factual | How quickly are standard support requests answered? | Within 2 business days | ### Answer Standard support requests are answered within **2 business days**. | HIT | PASS |  |
| cortex-6 | cortex-handbook.pdf | factual | What response time do Pro plan enterprise customers get for support? | 4 hours | ### Response Time for Pro Plan Enterprise Customers Pro plan enterprise customers receive priority support with a response time of **4 hours**. | HIT | PASS |  |
| cortex-7 | cortex-handbook.pdf | adversarial | What is the refund policy for annual subscriptions? | I couldn't find this information in the uploaded PDF. | I couldn't find this information in the uploaded PDF. | n/a | PASS | Correctly refused out-of-scope question. |
| aurora-1 | aurora-hr-handbook.pdf | factual | How many paid leave days do full-time employees get per calendar year? | 18 paid leave days | ### Paid Leave Days for Full-Time Employees Full-time employees at Aurora Robotics receive **18 paid leave days** per calendar year, in addition to 10 public ho | HIT | PASS |  |
| aurora-2 | aurora-hr-handbook.pdf | factual | How many days per week can an employee work remotely with manager approval? | 3 days per week | ### Remote Work Policy According to the Aurora Robotics Employee Handbook, employees may work remotely **up to 3 days per week** with their manager's approval. | HIT | PASS |  |
| aurora-3 | aurora-hr-handbook.pdf | factual | Within how many days must an expense report be submitted? | 30 days | ### Expense Report Submission Timeframe Expense reports must be submitted within **30 days** of the expense being incurred. | HIT | PASS |  |
| aurora-4 | aurora-hr-handbook.pdf | factual | How long is the probation period for new employees? | 90 days | ### Probation Period The probation period for new employees at Aurora Robotics is **90 days** from their start date. | HIT | PASS |  |
| aurora-5 | aurora-hr-handbook.pdf | factual | How many weeks of paid parental leave do primary caregivers receive? | 26 weeks | ### Answer Primary caregivers are entitled to **26 weeks** of paid parental leave. | HIT | PASS |  |
| aurora-6 | aurora-hr-handbook.pdf | factual | Within how many business days must an employee disclose a conflict of interest? | 5 business days | ### Disclosure of Conflict of Interest Employees must disclose any conflict of interest to their manager within **5 business days** of becoming aware of it. | HIT | PASS |  |
| aurora-7 | aurora-hr-handbook.pdf | adversarial | What is Aurora Robotics' stock ticker symbol? | I couldn't find this information in the uploaded PDF. | I couldn't find this information in the uploaded PDF. | n/a | PASS | Correctly refused out-of-scope question. |
| solar-1 | solar-pv-primer.pdf | factual | What efficiency range do monocrystalline panels typically achieve? | 20-22% | ### Efficiency Range of Monocrystalline Panels Monocrystalline panels typically operate at a efficiency range of **20-22%**. | HIT | PASS |  |
| solar-2 | solar-pv-primer.pdf | factual | What does a microinverter do? | Converts DC to AC at each individual panel. | ### Microinverter Function A microinverter converts DC (direct current) to AC (alternating current) at each individual panel. This improves performance when pan | HIT | PASS |  |
| solar-3 | solar-pv-primer.pdf | factual | What is the typical size range for a residential solar system? | 5kW to 10kW | ### Typical Residential Solar System Size Range A typical residential solar system size ranges from **5kW to 10kW**, depending on household electricity consumpt | HIT | PASS |  |
| solar-4 | solar-pv-primer.pdf | factual | How often should solar panels be inspected? | Twice a year | ### Inspection Frequency Solar panels should be inspected **twice a year** for physical damage and loose connections. | HIT | PASS |  |
| solar-5 | solar-pv-primer.pdf | factual | By how much can dust and debris reduce panel output? | Up to 25% | Dust and debris accumulation can reduce panel output by **up to 25%** if panels are not periodically cleaned. | HIT | PASS |  |
| solar-6 | solar-pv-primer.pdf | factual | What is the average annual degradation rate of solar panels? | About 0.5% per year | ### Average Annual Degradation Rate The average annual degradation rate of solar panels is **0.5% per year** under normal operating conditions. Most manufacture | HIT | PASS |  |
| solar-7 | solar-pv-primer.pdf | adversarial | What warranty period applies to the inverter's internal battery? | I couldn't find this information in the uploaded PDF. | I couldn't find this information in the uploaded PDF. | n/a | PASS | Correctly refused out-of-scope question. |
