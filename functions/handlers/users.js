const { db, admin } = require('../utils/admin')

const config = require('../utils/config')
const firebase = require('firebase')
firebase.initializeApp(config)

const { validateSignupData, validateLoginData, reduceUserDetails } = require('../utils/validators')

// Signup users
exports.signup = (req, res) => {

    const newUser = {
        email: req.body.email,
        password: req.body.password,
        confirmpassword: req.body.confirmpassword,
        handle: req.body.handle
    }
    
    const { valid, errors } = validateSignupData(newUser)
    if (!valid) return res.status(400).json(errors)

    const noImage = 'blank-profile-picture.png'

    // validate data
    let token, userId
    db.doc(`/users/${newUser.handle}`).get()
        .then(doc => {
            if(doc.exists) {
                return res.status(400).json({ handle: 'This handle is already taken' })
            } else {
                return firebase
                    .auth()
                    .createUserWithEmailAndPassword(newUser.email, newUser.password)
            }
        })
        .then(data => {
            userId = data.user.uid
            return data.user.getIdToken()
        })
        .then(tokenId => {
            token = tokenId

            const userCredentials = {
                handle: newUser.handle,
                email: newUser.email,
                createdAt: new Date().toISOString(),
                imageUrl: `https://firebasestorage.googleapis.com/v0/b/${config.storageBucket}/o/${noImage}?alt=media`,
                userId: userId,
            }
            return db.doc(`/users/${newUser.handle}`).set(userCredentials)
        })
        .then(() => {
            return res.status(201).json({ token })
        })
        .catch(err => {
            console.log(err)
            if(err.code === 'auth/email-already-in-use') {
                return res.status(400).json({ email: 'Email is already in use'})
            } else {
                return res.status(500).json({ general: 'something went wrong, please try again' })  
            }      
        })
}

// Login users
exports.login = (req, res) => {
    const user = {
        email: req.body.email,
        password: req.body.password
    }

    const { valid, errors } = validateLoginData(user)
    if(!valid) return res.status(400).json(errors)

    firebase
        .auth()
        .signInWithEmailAndPassword(user.email, user.password)
        .then(data => {
            return data.user.getIdToken()
        })
        .then(token => {
            return res.json({ token })
        })
        .catch(err => {
            console.log(err)
            // auth/wrong-password
            // auth/user-not-user
            return res.status(403).json({ general: "Wrong credentials, please try again"})

        })
}

// Add user details
exports.addUserDetails = (req, res) => {
    let userDetails = reduceUserDetails(req.body)

    db.doc(`/users/${req.user.handle}`)
        .update(userDetails)
        .then(() => {
            return res.json({ message: 'Details add successfully' })
        })
        .catch(err => {
            console.error(err)
            return res.status(500).json({error: err.code})
        })
}

// Get any user's details
exports.getUserDetails = (req, res) => {
    let userData = {}

    db.doc(`/users/${req.params.handle}`).get()
        .then((doc) => {

            if (doc.exists) {
                userData.user = doc.data()
                return db
                    .collection('screams')
                    .where('userHandle', '==', req.params.handle)
                    .orderBy('createdAt', 'desc')
                    .get()
            } else {
                return res.status(404).json({ error: 'User not found from getUserDetails' })
            }
        })
        .then((data) => {
            userData.screams = []
            
            data.forEach((doc) => {
                userData.screams.push({
                    body: doc.data().body,
                    createdAt: doc.data().createdAt,
                    userHandle: doc.data().userHandle,
                    userImage: doc.data().userImage,
                    likeCount: doc.data().likeCount,
                    commentCount: doc.data().commentCount,
                    screamId: doc.id
                })
            })
            return res.json(userData)
        })
        .catch((err) => {
            console.error(err)
            return res.status(500).json({ error: err.code })
        })
}

// Get own user details
exports.getAuthenticatedUser = (req, res) => {
    let userData = {}

    db.doc(`/users/${req.user.handle}`).get()
        .then(doc => {
            if(doc.exists) {
                userData.credentials = doc.data()
                return db.collection('like')
                    .where('userHandle', '==', req.user.handle)
                    .get()
            }
        })
        .then(data => {
            userData.likes = []

            data.forEach(doc => {
                userData.likes.push(doc.data())
            })
            return db.collection('notifications')
                .where('recipient', '==', req.user.handle)
                .orderBy('createdAt', 'desc')
                .limit(10)
                .get()
        })
        .then((data) => {
            userData.notifications = []

            data.forEach((doc) => {
                userData.notifications.push({
                    recipient: doc.data().recipient,
                    sender: doc.data().sender,
                    createdAt: doc.data().createdAt,
                    screamId: doc.data().screamId,
                    type: doc.data().type,
                    read: doc.data().read,
                    notificationId: doc.id
                })
            })
            return res.json(userData)
        })
        .catch(err => {
            console.log(err)
            return res.status(500).json({ error: err.code })
        })
}


// Upload Image
exports.uploadImage = (req, res) => {
    const Busboy = require('busboy')
    const path = require('path')
    const os = require('os')
    const fs = require('fs')

    let imageFileName;
    let imageToBeUploaded = {}

    const busboy = new Busboy({ headers: req.headers })

    // only need file, filename, and mimetype but need the rest or else our mimetype will be in the wrong order
    busboy.on('file', (fieldname, file, filename, encoding, mimetype) => {
        if (mimetype !== 'image/jpeg' && mimetype !== 'image/png') {
            return res.status(400).json({ error: 'Wrong file type submitted'})
        }
        // my.image.png - split at '.' and pop the png extention off and return it
        const imageExtenstion = filename.split('.').pop()
        // 2131233211.png - generates random filename .png
        imageFileName = `${Math.round(Math.random()*1000000000).toString()}.${imageExtenstion}`
        const filepath = path.join(os.tmpdir(), imageFileName)
        imageToBeUploaded = { filepath, mimetype }
        file.pipe(fs.createWriteStream(filepath))
    })

    busboy.on('finish', () => {
        admin.storage().bucket(`${config.storageBucket}`).upload(imageToBeUploaded.filepath, {
            resumable: false,
            metadata: {
                metadata: {
                    contentType: imageToBeUploaded.mimetype
                }
            }
        })
        .then(() => {
            const imageUrl = `https://firebasestorage.googleapis.com/v0/b/${config.storageBucket}/o/${imageFileName}?alt=media`
            return db.doc(`/users/${req.user.handle}`).update({ imageUrl })
        })
        .then(() => {
            return res.json({ message: 'image uploaded successfully'})
        })
        .catch(err => {
            console.error(err)
            return res.status(500).json({ error: 'something went wrong'})
        })
    })

    busboy.end(req.rawBody)
}

// Notifications marked as read
exports.markNotificationsRead = (req, res) => {
    // batch use to update multiple documents - array of strings
    let batch = db.batch()

    req.body.forEach((notificationId) => {
        const notification = db.doc(`/notifications/${notificationId}`)
        batch.update(notification, { read: true })
    })
    // commit after notification has been updated to true
    batch.commit()
        .then(() => {
            return res.json({ message: 'Notifications marked read' })
        })
        .catch(err => {
            console.log(err)
            return res.status(500).json({ error: err.code})
        })
}