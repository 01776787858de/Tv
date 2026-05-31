name: Auto Update Channels

on:
  schedule:
    # يعمل تلقائياً كل 6 ساعات
    - cron: '0 */6 * * *'
  workflow_dispatch: # لتشغيل البوت يدوياً بضغطة زر

jobs:
  update:
    runs-on: ubuntu-latest

    steps:
    # 1. سحب الكود الحالي من المستودع
    - name: Checkout Repository
      uses: actions/checkout@v4

    # 2. إعداد بيئة بايثون
    - name: Set up Python
      uses: actions/setup-python@v5
      with:
        python-version: '3.10'

    # 3. تثبيت المكتبات المطلوبة (إذا كان لديك ملف requirements.txt)
    - name: Install Dependencies
      run: |
        python -m pip install --upgrade pip
        if [ -f requirements.txt ]; then pip install -r requirements.txt; fi

    # 4. البحث التلقائي عن أي ملف بايثون وتشغيله (الحل الذكي لعدم معرفة اسم الملف)
    - name: Run Update Script
      run: |
        SCRIPT_FILE=$(find . -maxdepth 1 -name "*.py" ! -name "test*.py" | head -n 1)
        if [ -z "$SCRIPT_FILE" ]; then
          echo "خطأ: لم يتم العثور على أي ملف بايثون (.py) في المجلد الرئيسي!"
          exit 1
        fi
        echo "جاري تشغيل الملف: $SCRIPT_FILE"
        python "$SCRIPT_FILE"

    # 5. تعريف البوت ورفع الملفات الجديدة للمستودع لمنع الخطأ 128
    - name: Commit and Push Changes
      run: |
        git config --local user.email "github-actions[bot]@users.noreply.github.com"
        git config --local user.name "github-actions[bot]"
        git add .
        # التحقق إذا كان هناك أي ملفات جديدة تم تحديثها لرفعها
        git diff-index --quiet HEAD || git commit -m "Auto Update: Channels updated"
        git push
