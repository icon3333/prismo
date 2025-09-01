# Portfolio Rebalancer - Simple Usage

## 🎯 **One Command for Everything**

```bash
./app.sh
```

That's it! The script automatically:
- ✅ **First time?** → Sets up everything from scratch
- ✅ **Code changed?** → Quick update (~30 seconds)  
- ✅ **Docker files changed?** → Full rebuild (~3 minutes)
- ✅ **Container broken?** → Fixes and rebuilds
- ✅ **Already running?** → "Already perfect!"

## 📊 **Check Status**

```bash
./app.sh --status
```

Shows if your app is healthy and running.

## 🆘 **Get Help**

```bash
./app.sh --help
```

Shows all available options.

---

## 🚀 **Example Workflow**

```bash
# First time setup
./app.sh
# → Takes ~3 minutes, sets up everything

# Later, after code changes
./app.sh  
# → Takes ~30 seconds, quick update

# Check if everything is OK
./app.sh --status
# → Instant status report

# App running at: http://localhost:8065
```

**That's literally all you need to know!** 🎉
