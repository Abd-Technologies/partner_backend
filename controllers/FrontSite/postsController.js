const { Op } = require('sequelize');
const { Post, Reply, Like, User, UserPlan, Plan } = require('../../models');
const ApiResponse = require('../../helper/ApiResponse');
const { getIO } = require('../../socket');

// Roles that bypass the paid-plan requirement and skip post moderation.
// Anyone whose userType is not 'User' is treated as staff/admin.
const STAFF_ROLES = new Set([
  'Admin',
  'Trainer',
  'Dietition',
  'Gynecologist',
  'Psychiatrist',
]);

const isStaff = (user) => !!user && STAFF_ROLES.has(user.userType);

// "Paid" = an active, non-free-trial UserPlan that has not expired.
// Free-trial users hold a UserPlan whose Plan.title === 'Free Trial' — we
// exclude that with a required Plan include.
const hasActivePaidPlan = async (userId) => {
  const plan = await UserPlan.findOne({
    where: {
      userId,
      status: true,
      expireDate: { [Op.gte]: new Date() },
    },
    include: [
      {
        model: Plan,
        where: { title: { [Op.ne]: 'Free Trial' } },
        required: true,
      },
    ],
  });
  return !!plan;
};

// Returns null if the user may post/comment, otherwise a denial message.
const denyIfNotCreator = async (user) => {
  if (isStaff(user)) return null;
  const paid = await hasActivePaidPlan(user.id);
  return paid
    ? null
    : 'Active paid plan required to post or comment. Free-trial users can like only.';
};

const toBool = (val, fallback) => {
  if (val === undefined || val === null) return fallback;
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') return val.toLowerCase() === 'true';
  return Boolean(val);
};

// Store a relative path only. Building the absolute URL here couples
// image scheme to whatever req.protocol returns — which is "http" when
// behind a reverse proxy without `app.set('trust proxy', ...)`, leading
// to iOS ATS / Android cleartext-traffic blocking the image load.
// The client prepends its own baseUrl (always the working scheme it's
// already talking to the API on), so the protocol is never wrong.
const buildImageUrl = (req) => {
  if (!req.file) return null;
  return `/public/posts/${req.file.filename}`;
};

// Get all posts (with replies + likes count).
// Approved feed is open to any logged-in user.
// Pending feed (approved=false) is admin-only — it is the moderation queue.
exports.getAllPosts = async (req, res) => {
  try {
    const { approved } = req.params;

    if (approved !== 'true' && approved !== 'false') {
      return res
        .status(400)
        .json(ApiResponse('0', "Invalid approved param. Use 'true' or 'false'.", {}));
    }

    const isApproved = approved === 'true';

    if (!isApproved) {
      const requester = await User.findByPk(req.user.id);
      if (!requester || requester.userType !== 'Admin') {
        return res
          .status(403)
          .json(ApiResponse('0', 'Admin access required to view pending posts', {}));
      }
    }

    const whereCondition = { approved: isApproved };
    if (!isApproved) {
      whereCondition.isPost = true;
    }

    const postOrder = isApproved ? [['createdAt', 'ASC']] : [['createdAt', 'DESC']];

    const queryOpts = {
      where: whereCondition,
      include: [
        { model: User, attributes: ['id', 'firstName', 'lastName', 'email'] },
        {
          model: Reply,
          as: 'messages',
          separate: true,
          order: [['createdAt', 'ASC']],
          include: [
            { model: User, attributes: ['id', 'firstName', 'lastName', 'email'] },
          ],
        },
        { model: Like, as: 'likes', attributes: ['userId'] },
      ],
      order: postOrder,
    };

    if (req.query.limit !== undefined) {
      queryOpts.limit = parseInt(req.query.limit, 10) || 50;
    }
    if (req.query.offset !== undefined) {
      queryOpts.offset = parseInt(req.query.offset, 10) || 0;
    }

    const posts = await Post.findAll(queryOpts);

    const data = posts.map((post) => {
      const postJson = post.toJSON();
      postJson.likeCount = postJson.likes?.length || 0;
      return postJson;
    });

    return res.json(ApiResponse('1', 'Posts fetched successfully', { posts: data }));
  } catch (error) {
    console.error('[posts] getAllPosts error:', error);
    return res.status(500).json(ApiResponse('0', 'Failed to fetch posts', {}));
  }
};

// Create a new post (main message).
// Posting is restricted to staff (Trainer, Dietition, etc.) and paid users.
exports.createPost = async (req, res) => {
  try {
    const userId = req.user.id;
    const { text, isPost: isPostRaw } = req.body;

    const trimmedText = typeof text === 'string' ? text.trim() : '';
    if (!req.file && !trimmedText) {
      return res
        .status(400)
        .json(ApiResponse('0', 'Post must include text or an image', {}));
    }

    const author = await User.findByPk(userId);
    if (!author) {
      return res.status(404).json(ApiResponse('0', 'User not found', {}));
    }

    const denyReason = await denyIfNotCreator(author);
    if (denyReason) {
      return res.status(403).json(ApiResponse('0', denyReason, {}));
    }

    const isPost = toBool(isPostRaw, true);
    const imageUrl = buildImageUrl(req);
    const hasImage = Boolean(req.file);

    // Approval rules:
    // - Non-post entries (isPost=false) are not subject to feed moderation.
    // - Staff (Trainer, Dietition, Admin, etc.) never need approval.
    // - Text-only posts auto-approve; image posts by regular paid users
    //   require admin approval.
    const approved = !isPost || isStaff(author) || !hasImage;

    const createdPost = await Post.create({
      text: trimmedText || null,
      isPost,
      approved,
      userId,
      imageUrl,
    });

    const newPost = await Post.findOne({
      where: { id: createdPost.id },
      include: [
        { model: User, attributes: { exclude: ['password'] } },
      ],
    });

    if (approved) {
      const io = getIO();
      console.log('[posts] emitting newPost', newPost.id);
      io.to('community').emit('newPost', newPost);
    }

    return res
      .status(201)
      .json(ApiResponse('1', 'Post created successfully', { post: newPost }));
  } catch (error) {
    console.error('[posts] createPost error:', error);
    return res.status(500).json(ApiResponse('0', 'Failed to create post', {}));
  }
};

// Create a reply (comment). Same gate as createPost — paid or staff only.
exports.createReply = async (req, res) => {
  try {
    const userId = req.user.id;
    const { postId, text } = req.body;

    if (!postId || !text || !String(text).trim()) {
      return res
        .status(400)
        .json(ApiResponse('0', 'postId and text are required', {}));
    }

    const author = await User.findByPk(userId);
    if (!author) {
      return res.status(404).json(ApiResponse('0', 'User not found', {}));
    }

    const denyReason = await denyIfNotCreator(author);
    if (denyReason) {
      return res.status(403).json(ApiResponse('0', denyReason, {}));
    }

    const post = await Post.findByPk(postId);
    if (!post) return res.status(404).json(ApiResponse('0', 'Post not found', {}));

    const reply = await Reply.create({
      postId,
      userId,
      text: String(text).trim(),
    });

    const replyWithUser = await Reply.findByPk(reply.id, {
      include: [
        { model: User, attributes: ['id', 'firstName', 'lastName', 'email'] },
      ],
    });

    const io = getIO();
    console.log('[posts] emitting replyWithUser', reply.id);
    io.to(`post_${postId}`).emit('replyWithUser', replyWithUser);
    io.to('community').emit('replyCreated', {
      postId: Number(postId),
      reply: replyWithUser,
    });

    return res
      .status(201)
      .json(ApiResponse('1', 'Reply sent successfully', { reply: replyWithUser }));
  } catch (error) {
    console.error('[posts] createReply error:', error);
    return res.status(500).json(ApiResponse('0', 'Failed to send reply', {}));
  }
};

// Like or Unlike a post — open to every authenticated user, including
// free-trial / unpaid users. Liking does not require an active plan.
//
// Race safety comes from the unique index on Likes(postId, userId) — see
// migrations/20260502120000-add-unique-index-to-likes.js. findOrCreate plus
// the unique-violation catch makes this idempotent under concurrent calls.
exports.toggleLike = async (req, res) => {
  try {
    const userId = req.user.id;
    const { postId } = req.body;

    if (!postId) {
      return res.status(400).json(ApiResponse('0', 'postId is required', {}));
    }

    const io = getIO();

    try {
      const [like, created] = await Like.findOrCreate({
        where: { postId, userId },
        defaults: { postId, userId },
      });

      if (!created) {
        await like.destroy();
        io.to(`post_${postId}`).emit('toggleLike', { postId, like: false });
        return res.json(ApiResponse('1', 'Like removed', {}));
      }

      io.to(`post_${postId}`).emit('toggleLike', { postId, like: true });
      return res.json(ApiResponse('1', 'Post liked', {}));
    } catch (err) {
      // Lost the race — another request created the row between our find and
      // create. Treat as "already liked" rather than failing the request.
      if (err.name === 'SequelizeUniqueConstraintError') {
        return res.json(ApiResponse('1', 'Post liked', {}));
      }
      throw err;
    }
  } catch (error) {
    console.error('[posts] toggleLike error:', error);
    return res.status(500).json(ApiResponse('0', 'Failed to toggle like', {}));
  }
};

// Delete a post — owner or admin only.
exports.deletePost = async (req, res) => {
  try {
    const { id } = req.params;
    const post = await Post.findByPk(id);

    if (!post) return res.status(404).json(ApiResponse('0', 'Post not found', {}));

    const requester = await User.findByPk(req.user.id);
    const isOwner = post.userId === req.user.id;
    const isAdmin = requester && requester.userType === 'Admin';
    if (!isOwner && !isAdmin) {
      return res
        .status(403)
        .json(ApiResponse('0', 'Not authorized to delete this post', {}));
    }

    await post.destroy();

    const io = getIO();
    console.log('[posts] emitting postDeleted', id);
    io.to('community').emit('postDeleted', { id: parseInt(id, 10) });
    io.to(`post_${id}`).emit('postDeleted', { id: parseInt(id, 10) });

    return res.json(ApiResponse('1', 'Post deleted successfully', {}));
  } catch (error) {
    console.error('[posts] deletePost error:', error);
    return res.status(500).json(ApiResponse('0', 'Failed to delete post', {}));
  }
};

// Approve a post — admin only.
exports.approvePost = async (req, res) => {
  try {
    const requester = await User.findByPk(req.user.id);
    if (!requester || requester.userType !== 'Admin') {
      return res.status(403).json(ApiResponse('0', 'Admin access required', {}));
    }

    const { id } = req.params;
    const post = await Post.findOne({
      where: { id },
      include: [
        { model: User, attributes: { exclude: ['password'] } },
      ],
    });

    if (!post) return res.status(404).json(ApiResponse('0', 'Post not found', {}));

    post.approved = true;
    await post.save();

    const io = getIO();
    console.log('[posts] emitting postApproved', post.id);
    io.to('community').emit('postApproved', post);
    io.to('community').emit('newPost', post);

    return res.json(ApiResponse('1', 'Post approved successfully', { post }));
  } catch (error) {
    console.error('[posts] approvePost error:', error);
    return res.status(500).json(ApiResponse('0', 'Failed to approve post', {}));
  }
};
